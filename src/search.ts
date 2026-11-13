/**
 * General lexical relevance engine for the layer catalog.
 *
 * Replaces the hand-written per-topic synonym lists (src/topics.ts, removed)
 * with a real full-text search engine, following the approach of IGN France's
 * GeoContext (https://github.com/ignfab/geocontext, MIT). GeoContext builds a
 * MiniSearch index over per-layer search documents with field boosts,
 * diacritic-folding term normalization and fuzzy matching (see its
 * gpf-schema-store package), and lets the calling assistant handle semantics
 * (it documents: "prefer domain terms", the LLM rephrases and expands).
 *
 * What we adopt from that design:
 *  - MiniSearch over search documents projected from catalog entries.
 *  - Field boosting (title > identifier tokens > keywords > abstract), plus
 *    province/source fields so geographic intent narrows results.
 *  - Term normalization: lowercase + NFD diacritic stripping (same as
 *    GeoContext's processTerm), extended with light Spanish plural reduction
 *    ("canales" -> "canal", "pozos" -> "pozo") applied to index and query.
 *  - Fuzzy matching limited to longer terms, so short Spanish words do not
 *    collide ("calor" must not match "color"/"valor").
 *  - No per-topic synonym lists anywhere: cross-language/semantic bridging of
 *    the bilingual catalog metadata is the client assistant's job, via the
 *    `relatedTerms` parameter of search_layers/suggest_layers.
 */
import MiniSearch from 'minisearch';
import type { SearchResult as MiniSearchResult } from 'minisearch';
import { loadCatalog, normalize } from './catalog.js';
import type { CatalogEntry } from './catalog.js';
import { ServiceType } from './service-type.js';

/**
 * Function words with no layer-discriminating value, filtered from index and
 * query terms alike (MiniSearch processTerm). Language mechanics only, not
 * domain vocabulary: BM25-style scoring already downweights frequent terms.
 */
export const STOPWORDS = new Set([
  'quiero', 'quisiera', 'hacer', 'armar', 'armando', 'armo', 'necesito', 'saber', 'cuanto', 'cuanta',
  'cuantos', 'cuantas', 'cual', 'cuales', 'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'de',
  'del', 'en', 'y', 'o', 'a', 'por', 'para', 'con', 'sobre', 'que', 'me', 'te', 'se', 'lo', 'es', 'hay',
  'mapa', 'mapas', 'capa', 'capas', 'dato', 'datos', 'dataset', 'datasets', 'puedo', 'puede',
  'podemos', 'podria', 'podrias', 'ir', 'usar', 'utilizar', 'mostrar', 'mostrame', 'ver', 'buscar',
  'encontrar', 'tengo', 'tiene', 'tienen', 'esta', 'este', 'estas', 'estos', 'algo', 'algun', 'alguna',
  'algunos', 'algunas', 'como', 'donde', 'cuando', 'porque', 'pero', 'si', 'no', 'todo', 'toda', 'todos',
  'todas', 'mas', 'muy', 'sin', 'tambien', 'solo', 'want', 'need', 'build', 'show', 'make', 'create',
  'find', 'search', 'get', 'see', 'use', 'using', 'can', 'could', 'would', 'should', 'please', 'with',
  'without', 'for', 'from', 'about', 'the', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'my', 'our',
  'your', 'some', 'any', 'all', 'map', 'maps', 'layer', 'layers', 'data', 'list', 'suggest',
  'recommend', 'available', 'help', 'what', 'which', 'where', 'when', 'how', 'do', 'does', 'is', 'are',
  'i', 'we', 'you', 'it', 'this', 'that', 'these', 'those', 'there', 'here',
]);

/**
 * Light Spanish plural reduction applied symmetrically to index and query
 * terms, so "pozos" matches "pozo" and "canales" matches "canal". Only
 * handles the two dominant regular patterns; anything else is left to
 * prefix/fuzzy matching.
 */
function singularize(term: string): string {
  if (term.length >= 4 && term.endsWith('es')) {
    const stem = term.slice(0, -2);
    if (/[^aeiou]$/.test(stem)) return stem; // canales -> canal
  }
  if (term.length >= 4 && /[aeiou]s$/.test(term)) return term.slice(0, -1); // pozos -> pozo
  return term;
}

/** MiniSearch processTerm: normalize, drop stopwords, reduce plurals. */
function processTerm(term: string): string | false {
  const cleaned = normalize(term).trim();
  if (cleaned.length === 0 || STOPWORDS.has(cleaned)) return false;
  const singular = singularize(cleaned);
  return singular.length > 0 ? singular : false;
}

/** Splits identifiers like "dgct:fires_modis_24" into searchable tokens. */
function identifierTokens(typeName: string): string {
  return typeName.split(/[^A-Za-zÀ-ÿ0-9]+/).filter(Boolean).join(' ');
}

interface SearchDocument {
  id: string;
  title: string;
  typeName: string;
  keywords: string;
  abstract: string;
  province: string;
  source: string;
}

const INDEXED_FIELDS: Array<keyof SearchDocument & string> = [
  'title',
  'typeName',
  'keywords',
  'abstract',
  'province',
  'source',
];

/**
 * Field boosts, adapted from GeoContext's gpf-schema-store defaults
 * (title 4, identifier tokens 3.5, description ~1) to this catalog's fields.
 */
const FIELD_BOOST = { title: 4, typeName: 3.5, keywords: 3, abstract: 1, province: 2, source: 1.5 };

/**
 * Default search behaviour shared by search_layers and suggest_layers.
 * Fuzzy matching only for terms of 7+ letters: enough for typos and word-form
 * variation on long words, strict enough that short terms stay precise.
 */
const SEARCH_OPTIONS = {
  prefix: true,
  fuzzy: (term: string) => (term.length >= 7 ? 0.15 : false),
  boost: FIELD_BOOST,
};

export interface CatalogSearchHit {
  entry: CatalogEntry;
  score: number;
  /** Processed query terms that matched this layer. */
  queryTerms: string[];
  /** Matched index term -> document fields where it was found. */
  match: Record<string, string[]>;
}

let engine: { mini: MiniSearch<SearchDocument>; byId: Map<string, CatalogEntry> } | null = null;

function getEngine(): { mini: MiniSearch<SearchDocument>; byId: Map<string, CatalogEntry> } {
  if (!engine) {
    const catalog = loadCatalog();
    const mini = new MiniSearch<SearchDocument>({
      idField: 'id',
      fields: [...INDEXED_FIELDS],
      processTerm,
    });
    const byId = new Map<string, CatalogEntry>();
    const docs: SearchDocument[] = catalog.layers.map((entry) => {
      byId.set(entry.id, entry);
      return {
        id: entry.id,
        title: entry.title,
        typeName: identifierTokens(entry.typeName),
        keywords: entry.keywords.join(' '),
        abstract: entry.abstract,
        province: entry.province,
        source: entry.source,
      };
    });
    mini.addAll(docs);
    engine = { mini, byId };
  }
  return engine;
}

/** Test hook: drop the cached index (catalog reloads rebuild it). */
export function resetSearchEngine(): void {
  engine = null;
}

export interface CatalogSearchOptions {
  limit?: number;
  serviceType?: ServiceType;
  province?: string;
}

/**
 * Searches the catalog with the MiniSearch engine. Results are ranked by the
 * engine's score; serviceType/province filters are applied before the limit.
 */
export function searchCatalog(query: string, options: CatalogSearchOptions = {}): CatalogSearchHit[] {
  const { mini, byId } = getEngine();
  const wantedProvince = options.province ? normalize(options.province) : null;
  const results = mini.search(query, SEARCH_OPTIONS);
  const hits: CatalogSearchHit[] = [];
  for (const result of results as MiniSearchResult[]) {
    const entry = byId.get(String(result.id));
    if (!entry) continue;
    if (options.serviceType && !(entry.services ?? []).some((s) => s.type === options.serviceType)) continue;
    if (wantedProvince && normalize(entry.province ?? '') !== wantedProvince) continue;
    hits.push({
      entry,
      score: result.score,
      queryTerms: result.queryTerms,
      match: result.match as Record<string, string[]>,
    });
    if (options.limit !== undefined && hits.length >= options.limit) break;
  }
  return hits;
}

/** Meaningful (post-processTerm) terms of a free-text fragment, in order. */
export function meaningfulTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[^A-Za-zÀ-ÿ0-9]+/)) {
    const term = processTerm(raw);
    if (term) seen.add(term);
  }
  return Array.from(seen);
}

/** True when at least one catalog layer matches the term (exact/prefix/fuzzy). */
export function termCovered(term: string): boolean {
  return searchCatalog(term, { limit: 1 }).length > 0;
}
