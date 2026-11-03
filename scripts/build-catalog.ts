/** Generates data/catalog.json from the live GetCapabilities of the official endpoints. */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ENDPOINTS } from '../src/endpoints.js';
import { getCapabilities } from '../src/wfs.js';
import { getWmsCapabilities } from '../src/wms.js';
import { ServiceType } from '../src/service-type.js';
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

function wmsUrlOf(wfsUrl: string): string {
  return wfsUrl.replace(/\/wfs\/?$/, '/wms');
}

function stripWorkspace(name: string): string {
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}

function cleanText(value: string): string {
  return (value || '').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
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
    const entries: CatalogEntry[] = caps.map((c) => ({
      id: `${ep.id}:${c.typeName}`,
      source: ep.id,
      typeName: c.typeName,
      title: c.title || c.typeName,
      abstract: cleanText(c.abstract),
      endpoint: ep.url,
      defaultCrs: c.defaultCrs || 'unknown',
      keywords: keywordsOf(c.typeName, c.title),
      verifiedAt: today,
      services: [{ type: ServiceType.Wfs, endpoint: ep.url, typeName: c.typeName }],
    }));
    if (ep.id === 'geosplan' || ep.id === 'dgct') {
      const wmsUrl = wmsUrlOf(ep.url);
      try {
        const wmsCaps = await getWmsCapabilities(wmsUrl);
        for (const w of wmsCaps) {
          const match = entries.find(
            (e) => w.name === e.typeName || w.name === stripWorkspace(e.typeName),
          );
          if (match) {
            match.services.push({
              type: ServiceType.Wms,
              endpoint: wmsUrl,
              typeName: w.name,
            });
          } else {
            entries.push({
              id: `${ep.id}:${w.name}`,
              source: ep.id,
              typeName: w.name,
              title: w.title || w.name,
              abstract: cleanText(w.abstract),
              endpoint: wmsUrl,
              defaultCrs: w.crs[0] || 'unknown',
              keywords: keywordsOf(w.name, w.title),
              verifiedAt: today,
              services: [{ type: ServiceType.Wms, endpoint: wmsUrl, typeName: w.name }],
            });
          }
        }
        sources[ep.id] = { status: 'live', fetchedAt: new Date().toISOString(), wmsStatus: 'live' };
        console.log(`${ep.id}: ${caps.length} WFS layers, ${wmsCaps.length} WMS layers`);
      } catch (err) {
        sources[ep.id] = { status: 'live', fetchedAt: new Date().toISOString(), wmsStatus: 'failed' };
        console.error(`${ep.id}: WMS GetCapabilities FAILED on ${today} — keeping WFS layers WFS-only (${err})`);
      }
    } else {
      sources[ep.id] = { status: 'live', fetchedAt: new Date().toISOString() };
      console.log(`${ep.id}: ${caps.length} layers`);
    }
    layers.push(...entries);
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
