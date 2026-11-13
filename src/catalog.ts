import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ServiceType } from './service-type.js';
import { searchCatalog } from './search.js';

export interface CatalogService {
  type: ServiceType;
  endpoint: string;
  typeName: string;
  crs?: string[];
  queryable?: boolean;
  extent?: [number, number, number, number];
}

export interface CatalogEntry {
  /** `${source}:${typeName}` */
  id: string;
  source: string;
  /** Official province name (Spanish), e.g. 'Córdoba'. National sources use 'Argentina (nacional)'. */
  province: string;
  typeName: string;
  title: string;
  abstract: string;
  endpoint: string;
  defaultCrs: string;
  keywords: string[];
  verifiedAt: string;
  services: CatalogService[];
}

export interface Catalog {
  generatedAt: string;
  sources: Record<string, { status: 'live' | 'preserved'; fetchedAt: string; wmsStatus?: 'live' | 'failed'; ridesFailedThemes?: string[]; failedServices?: string[] }>;
  layers: CatalogEntry[];
}

let cache: Catalog | null = null;

/**
 * Extra search terms per layer id (`source:typeName`), curated from user miss
 * reports. They merge into each entry's keywords when the catalog loads, so
 * they are searchable without regenerating data/catalog.json.
 */
export type LayerAliases = Record<string, string[]>;

/** Merges alias terms into each layer's keywords (deduped, in place). */
function applyAliases(catalog: Catalog, aliases: LayerAliases): Catalog {
  for (const entry of catalog.layers) {
    const extra = aliases[entry.id];
    if (!extra || extra.length === 0) continue;
    const seen = new Set(entry.keywords.map((k) => normalize(k)));
    for (const term of extra) {
      const key = normalize(term);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      entry.keywords.push(term);
    }
  }
  return catalog;
}

function dataPath(file: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'data', file);
}

/**
 * Resolves data/layer-aliases.json lazily. Missing file means no aliases; the
 * Cloudflare Worker imports the JSON directly and passes it to primeCatalog(),
 * so this never evaluates `import.meta.url` (undefined in workerd) there.
 */
export function loadLayerAliases(): LayerAliases {
  const path = dataPath('layer-aliases.json');
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { aliases?: LayerAliases };
  return parsed.aliases ?? {};
}

export function loadCatalog(): Catalog {
  if (!cache) {
    const catalog = JSON.parse(readFileSync(dataPath('catalog.json'), 'utf-8')) as Catalog;
    cache = applyAliases(catalog, loadLayerAliases());
  }
  return cache;
}

/**
 * Sets the in-memory catalog cache.
 * Used by the Cloudflare Worker, which imports data/catalog.json (and
 * data/layer-aliases.json) directly (Wrangler bundles JSON imports) so
 * loadCatalog() never touches `node:fs`.
 */
export function primeCatalog(catalog: Catalog, aliases: LayerAliases = {}): void {
  cache = applyAliases(catalog, aliases);
}

/** Normalizes for search: lowercase and accent-free. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Keyword search over the catalog. Delegates ranking to the MiniSearch engine
 * in search.ts (field boosts, prefix and bounded fuzzy matching, plural and
 * diacritic normalization); this wrapper keeps the historical signature.
 */
export function searchLayers(query: string, limit = 10, serviceType?: ServiceType, province?: string): CatalogEntry[] {
  return searchCatalog(query, { limit, serviceType, province }).map((hit) => hit.entry);
}

export function findLayer(typeName: string): CatalogEntry | undefined {
  const t = typeName.trim().toLowerCase();
  return loadCatalog().layers.find(
    (e) => e.typeName.toLowerCase() === t || e.id.toLowerCase() === t,
  );
}
