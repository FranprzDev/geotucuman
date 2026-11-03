import type { Catalog, CatalogEntry } from '../catalog.js';

export function layerFlags(entry: CatalogEntry, sources: Catalog['sources']): string[] {
  const flags: string[] = [];
  if (sources[entry.source]?.status === 'preserved') flags.push('stale-snapshot');
  if (entry.source === 'ign') flags.push('national-scope');
  if (entry.defaultCrs === 'unknown') flags.push('undeclared-crs');
  if (!entry.abstract) flags.push('no-abstract');
  return flags;
}
