/**
 * Raw GetCapabilities cache used by the catalog builder.
 *
 * Capability responses (WFS/WMS XML, ArcGIS REST JSON) are persisted verbatim so a
 * catalog can be rebuilt offline and byte-identically. The cache stores raw text only;
 * parsing is always done by the regular clients (`src/wfs.ts`, `src/wms.ts`, `src/arcgis.ts`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RawCacheTarget {
  /** Cache file path, or null to bypass persistence for this call. */
  file: string | null;
  /** When true, never touch the network: read `file` and fail if it is missing. */
  fromCache: boolean;
}

/** Thrown (or returned by the caller) when a required cache file is absent in offline mode. */
export const CACHE_MISS_PREFIX = 'capability cache file missing';

export function isCacheMiss(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(CACHE_MISS_PREFIX);
}

function missing(file: string | null): Error {
  return new Error(`${CACHE_MISS_PREFIX}: ${file ?? '(unspecified)'}`);
}

/**
 * Returns the raw response for `target`: from the cache file in offline mode, or by running
 * `fetcher` (and persisting the result) otherwise. When `target` is omitted the fetcher runs
 * with no persistence, preserving the original live behavior.
 */
export async function cachedResponse(
  target: RawCacheTarget | undefined,
  fetcher: () => Promise<string>,
): Promise<string> {
  if (!target) return fetcher();
  if (target.fromCache) {
    if (!target.file || !existsSync(target.file)) throw missing(target.file);
    return readFileSync(target.file, 'utf-8');
  }
  const text = await fetcher();
  if (target.file) {
    mkdirSync(dirname(target.file), { recursive: true });
    writeFileSync(target.file, text);
  }
  return text;
}

/** Synchronous variant for JSON payloads assembled by the ArcGIS client. */
export function readCachedJson(file: string | null): unknown {
  if (!file || !existsSync(file)) throw missing(file);
  return JSON.parse(readFileSync(file, 'utf-8'));
}

export function writeCachedJson(file: string | null, value: unknown): void {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}
