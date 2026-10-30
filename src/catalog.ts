import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface CatalogEntry {
  /** `${source}:${typeName}` */
  id: string;
  source: 'geosplan' | 'dgct' | 'ign';
  typeName: string;
  title: string;
  abstract: string;
  endpoint: string;
  defaultCrs: string;
  keywords: string[];
  verifiedAt: string;
}

export interface Catalog {
  generatedAt: string;
  layers: CatalogEntry[];
}

const here = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(here, '..', 'data', 'catalog.json');

let cache: Catalog | null = null;

export function loadCatalog(): Catalog {
  if (!cache) {
    cache = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8')) as Catalog;
  }
  return cache;
}

/** Normaliza para busqueda: minusculas y sin acentos. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Busqueda simple por substring sobre titulo, abstract, typeName y keywords.
 * Scoring: titulo pesa 3, typeName 2, keywords 2, abstract 1.
 */
export function searchLayers(query: string, limit = 10): CatalogEntry[] {
  const q = normalize(query).split(/\s+/).filter(Boolean);
  if (q.length === 0) return [];
  const scored: Array<{ e: CatalogEntry; score: number }> = [];
  for (const e of loadCatalog().layers) {
    const hay = {
      title: normalize(e.title),
      typeName: normalize(e.typeName),
      abstract: normalize(e.abstract),
      keywords: normalize(e.keywords.join(' ')),
    };
    let score = 0;
    for (const term of q) {
      if (hay.title.includes(term)) score += 3;
      if (hay.typeName.includes(term)) score += 2;
      if (hay.keywords.includes(term)) score += 2;
      if (hay.abstract.includes(term)) score += 1;
    }
    if (score > 0) scored.push({ e, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.e);
}

export function findLayer(typeName: string): CatalogEntry | undefined {
  const t = typeName.trim().toLowerCase();
  return loadCatalog().layers.find(
    (e) => e.typeName.toLowerCase() === t || e.id.toLowerCase() === t,
  );
}
