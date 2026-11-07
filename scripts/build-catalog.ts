/** Generates data/catalog.json from the live GetCapabilities of the official endpoints. */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ENDPOINTS, wmsUrlFor } from '../src/endpoints.js';
import type { EndpointConfig } from '../src/endpoints.js';
import { getCapabilities } from '../src/wfs.js';
import { getWmsCapabilities } from '../src/wms.js';
import type { WmsLayer } from '../src/wms.js';
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

function stripWorkspace(name: string): string {
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}

function themeOf(wmsUrl: string): string {
  const match = /\/services\/([^/]+)\/MapServer\/WMSServer\/?$/.exec(wmsUrl);
  return match ? match[1] : wmsUrl;
}

function cleanText(value: string): string {
  return (value || '').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
}

function wmsEntry(ep: EndpointConfig, wmsUrl: string, w: WmsLayer): CatalogEntry {
  return {
    id: `${ep.id}:${w.name}`,
    source: ep.id,
    province: ep.province,
    typeName: w.name,
    title: w.title || w.name,
    abstract: cleanText(w.abstract),
    endpoint: wmsUrl,
    defaultCrs: w.crs[0] || 'unknown',
    keywords: keywordsOf(w.name, w.title),
    verifiedAt: today,
    services: [
      { type: ServiceType.Wms, endpoint: wmsUrl, typeName: w.name, crs: w.crs, queryable: w.queryable },
    ],
  };
}

const today = new Date().toISOString().slice(0, 10);

/** One retry with a short pause: several provincial servers answer intermittently. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 2500));
    return fn();
  }
}
const layers: CatalogEntry[] = [];
const previous: Catalog | null = existsSync('data/catalog.json')
  ? (JSON.parse(readFileSync('data/catalog.json', 'utf-8')) as Catalog)
  : null;
let preserved = 0;
const sources: Catalog['sources'] = {};

function preserveFromSnapshot(ep: EndpointConfig, reason: string, failedThemes?: string[]): void {
  const stale = previous?.layers.filter((l) => l.source === ep.id) ?? [];
  if (stale.length === 0) {
    throw new Error(`${ep.id}: GetCapabilities FAILED and there is no previous snapshot to preserve — ${reason}`);
  }
  layers.push(
    ...stale.map((l) => ({
      ...l,
      services: l.services ?? [{ type: ServiceType.Wfs, endpoint: l.endpoint, typeName: l.typeName }],
    })),
  );
  preserved += stale.length;
  const failedField = failedThemes && failedThemes.length > 0 ? { ridesFailedThemes: failedThemes } : {};
  sources[ep.id] = {
    status: 'preserved',
    fetchedAt: previous?.sources?.[ep.id]?.fetchedAt ?? previous?.generatedAt ?? new Date().toISOString(),
    ...failedField,
  };
  console.error(`${ep.id}: GetCapabilities FAILED — preserving ${stale.length} layers from the previous snapshot (${reason})`);
}

for (const ep of ENDPOINTS) {
  // WMS-only flow: themed ArcGIS services (wmsServices) or a single WMS base (wmsOnly).
  const wmsServices = ep.wmsServices ?? (ep.wmsOnly ? [ep.url] : null);
  if (wmsServices) {
    const entries: CatalogEntry[] = [];
    const failedThemes: string[] = [];
    let answered = 0;
    for (const wmsUrl of wmsServices) {
      const theme = themeOf(wmsUrl);
      try {
        const wmsCaps = await withRetry(() => getWmsCapabilities(wmsUrl));
        answered += 1;
        for (const w of wmsCaps) entries.push(wmsEntry(ep, wmsUrl, w));
        console.log(`${ep.id}: ${theme} ${wmsCaps.length} WMS layers`);
      } catch (err) {
        failedThemes.push(theme);
        console.error(`${ep.id}: ${theme} WMS GetCapabilities FAILED on ${today} (${err})`);
      }
    }
    const failedField = failedThemes.length > 0 ? { ridesFailedThemes: failedThemes } : {};
    if (answered > 0) {
      layers.push(...entries);
      sources[ep.id] = {
        status: 'live',
        fetchedAt: new Date().toISOString(),
        wmsStatus: 'live',
        ...failedField,
      };
      console.log(`${ep.id}: ${entries.length} WMS layers from ${answered}/${wmsServices.length} theme services`);
    } else {
      preserveFromSnapshot(ep, failedThemes.join(', '), failedThemes);
      if (sources[ep.id]) sources[ep.id].wmsStatus = 'failed';
    }
    continue;
  }

  // WFS flow, with WMS merge for every endpoint that exposes one.
  try {
    const caps = await withRetry(() => getCapabilities(ep));
    const entries: CatalogEntry[] = caps.map((c) => ({
      id: `${ep.id}:${c.typeName}`,
      source: ep.id,
      province: ep.province,
      typeName: c.typeName,
      title: c.title || c.typeName,
      abstract: cleanText(c.abstract),
      endpoint: ep.url,
      defaultCrs: c.defaultCrs || 'unknown',
      keywords: keywordsOf(c.typeName, c.title),
      verifiedAt: today,
      services: [{ type: ServiceType.Wfs, endpoint: ep.url, typeName: c.typeName }],
    }));
    const wmsUrl = wmsUrlFor(ep);
    if (wmsUrl) {
      try {
        const wmsCaps = await withRetry(() => getWmsCapabilities(wmsUrl));
        for (const w of wmsCaps) {
          const match = entries.find(
            (e) => w.name === e.typeName || w.name === stripWorkspace(e.typeName),
          );
          if (match) {
            match.services.push({
              type: ServiceType.Wms,
              endpoint: wmsUrl,
              typeName: w.name,
              crs: w.crs,
              queryable: w.queryable,
            });
          } else {
            entries.push(wmsEntry(ep, wmsUrl, w));
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
    preserveFromSnapshot(ep, String(err));
  }
}

mkdirSync('data', { recursive: true });
const catalog: Catalog = { generatedAt: new Date().toISOString(), sources, layers };
writeFileSync('data/catalog.json', JSON.stringify(catalog, null, 2));
console.log(`data/catalog.json: ${layers.length} total layers${preserved ? ` (${preserved} preserved from previous snapshot)` : ''}`);
