/** Genera data/catalog.json desde los GetCapabilities en vivo de los endpoints oficiales. */
import { writeFileSync, mkdirSync } from 'node:fs';
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

for (const ep of ENDPOINTS) {
  try {
    const caps = await getCapabilities(ep);
    for (const c of caps) {
      layers.push({
        id: `${ep.id}:${c.typeName}`,
        source: ep.id,
        typeName: c.typeName,
        title: c.title || c.typeName,
        abstract: c.abstract || '',
        endpoint: ep.url,
        defaultCrs: c.defaultCrs || 'desconocido',
        keywords: keywordsOf(c.typeName, c.title),
        verifiedAt: today,
      });
    }
    console.log(`${ep.id}: ${caps.length} capas`);
  } catch (err) {
    console.error(`${ep.id}: FALLO GetCapabilities — ${err}`);
  }
}

mkdirSync('data', { recursive: true });
const catalog: Catalog = { generatedAt: new Date().toISOString(), layers };
writeFileSync('data/catalog.json', JSON.stringify(catalog, null, 2));
console.log(`data/catalog.json: ${layers.length} capas totales`);
