/** Generates data/catalog.json from the live GetCapabilities of the official endpoints. */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ENDPOINTS } from '../src/endpoints.js';
import { getCapabilities } from '../src/wfs.js';
import type { Catalog, CatalogEntry } from '../src/catalog.js';

const STOP = new Set(['de', 'la', 'el', 'del', 'y', 'en', 'los', 'las', 'para', 'con']);

function keywordsOf(typeName: string, title: string): string[] {
  const raw = `${typeName} ${title}`
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(raw)];
}

const today = new Date().toISOString().slice(0, 10);
const layers: CatalogEntry[] = [];
const previous: Catalog | null = existsSync('data/catalog.json')
  ? (JSON.parse(readFileSync('data/catalog.json', 'utf-8')) as Catalog)
  : null;
let preserved = 0;
const sources: Catalog['sources'] = {};

for (const ep of ENDPOINTS) {
  try {
    const caps = await getCapabilities(ep);
    for (const c of caps) {
      layers.push({
        id: `${ep.id}:${c.typeName}`,
        source: ep.id,
        typeName: c.typeName,
        title: c.title || c.typeName,
        abstract: (c.abstract || '').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim(),
        endpoint: ep.url,
        defaultCrs: c.defaultCrs || 'unknown',
        keywords: keywordsOf(c.typeName, c.title),
        verifiedAt: today,
      });
    }
    sources[ep.id] = { status: 'live', fetchedAt: new Date().toISOString() };
    console.log(`${ep.id}: ${caps.length} layers`);
  } catch (err) {
    const stale = previous?.layers.filter((l) => l.source === ep.id) ?? [];
    if (stale.length === 0) {
      throw new Error(`${ep.id}: GetCapabilities FAILED and there is no previous snapshot to preserve — ${err}`);
    }
    layers.push(...stale);
    preserved += stale.length;
    sources[ep.id] = {
      status: 'preserved',
      fetchedAt: previous?.sources?.[ep.id]?.fetchedAt ?? previous?.generatedAt ?? new Date().toISOString(),
    };
    console.error(`${ep.id}: GetCapabilities FAILED — preserving ${stale.length} layers from the previous snapshot (${err})`);
  }
}

mkdirSync('data', { recursive: true });
const catalog: Catalog = { generatedAt: new Date().toISOString(), sources, layers };
writeFileSync('data/catalog.json', JSON.stringify(catalog, null, 2));
console.log(`data/catalog.json: ${layers.length} total layers${preserved ? ` (${preserved} preserved from previous snapshot)` : ''}`);
