import { readFileSync } from 'node:fs';
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
 * Resolves data/catalog.json lazily. The Cloudflare Worker imports the JSON
 * directly and seeds the cache with primeCatalog(), so this never evaluates
 * `import.meta.url` (undefined in workerd) there.
 */
function catalogPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'data', 'catalog.json');
}

export function loadCatalog(): Catalog {
  if (!cache) {
    cache = JSON.parse(readFileSync(catalogPath(), 'utf-8')) as Catalog;
  }
  return cache;
}

/**
 * Sets the in-memory catalog cache.
 * Used by the Cloudflare Worker, which imports data/catalog.json directly
 * (Wrangler bundles JSON imports) so loadCatalog() never touches `node:fs`.
 */
export function primeCatalog(catalog: Catalog): void {
  cache = catalog;
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
