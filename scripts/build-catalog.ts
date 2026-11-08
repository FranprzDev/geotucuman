/** Generates data/catalog.json from the live GetCapabilities / ArcGIS REST of the official endpoints. */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ENDPOINTS, wmsUrlFor } from '../src/endpoints.js';
import type { EndpointConfig } from '../src/endpoints.js';
import { getCapabilities } from '../src/wfs.js';
import { getWmsCapabilities, selectWmsLayers } from '../src/wms.js';
import type { WmsLayer } from '../src/wms.js';
import { listArcgisServices, getArcgisLayersCached, mapPool } from '../src/arcgis.js';
import type { ArcGisLayerMeta } from '../src/arcgis.js';
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

const onlyEnv = process.env.GEOARG_ONLY;
const onlySet: Set<string> | null = onlyEnv
  ? new Set(onlyEnv.split(',').map((s) => s.trim()).filter(Boolean))
  : null;

function isOnlySkipped(id: string): boolean {
  return onlySet !== null && !onlySet.has(id);
}

function allowedArcgisService(svc: string): string {
  return svc.replace(/\/+$/, '');
}

/** True when an ArcGIS layer's service identity belongs to the config allowlist (or none is set). */
function arcgisServiceAllowed(ep: EndpointConfig, typeName: string): boolean {
  const whitelist = ep.arcgis?.services;
  if (!whitelist || whitelist.length === 0) return true;
  const idx = typeName.lastIndexOf('/');
  if (idx === -1) return false;
  const svc = typeName.slice(0, idx);
  return whitelist.some((s) => allowedArcgisService(s) === svc);
}

function preserveFromSnapshot(ep: EndpointConfig, reason: string, failedThemes?: string[], silent = false): void {
  let stale = previous?.layers.filter((l) => l.source === ep.id) ?? [];
  if (ep.arcgis?.services) {
    stale = stale.filter((l) => arcgisServiceAllowed(ep, l.typeName));
  }
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
  if (!silent) {
    console.error(`${ep.id}: GetCapabilities FAILED — preserving ${stale.length} layers from the previous snapshot (${reason})`);
  }
}

function preserveUnchanged(ep: EndpointConfig): void {
  const stale = previous?.layers.filter((l) => l.source === ep.id) ?? [];
  if (stale.length === 0) {
    console.error(`${ep.id}: GEOARG_ONLY skips this source but there is no previous snapshot to preserve`);
    return;
  }
  layers.push(
    ...stale.map((l) => ({
      ...l,
      services: l.services ?? [{ type: ServiceType.Wfs, endpoint: l.endpoint, typeName: l.typeName }],
    })),
  );
  preserved += stale.length;
  const prevSource = previous?.sources?.[ep.id];
  sources[ep.id] = prevSource
    ? { ...prevSource, status: 'preserved' }
    : {
        status: 'preserved',
        fetchedAt: previous?.generatedAt ?? new Date().toISOString(),
      };
}

function isGenericLayerName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return ['polygons', 'polygon', 'points', 'point', 'lines', 'line', 'layer', 'capa', 'features', 'feature layer'].includes(n) || /^layer[ _]?\d*$/.test(n);
}

function arcgisCrs(wkid: number | undefined): string {
  if (wkid === undefined || wkid === null) return 'unknown';
  if (wkid === 102100 || wkid === 102113) return 'EPSG:3857';
  return `EPSG:${wkid}`;
}

function arcgisEntry(
  ep: EndpointConfig,
  root: string,
  serviceName: string,
  layer: { id: number; name: string; description?: string; wkid?: number },
): CatalogEntry {
  const typeName = `${serviceName}/${layer.id}`;
  const endpoint = `${root.replace(/\/+$/, '')}/${serviceName}/FeatureServer/${layer.id}`;
  const humanizedService = serviceName.replace(/^Hosted\//, '').replace(/_/g, ' ').trim();
  const title = isGenericLayerName(layer.name || '') ? humanizedService : (layer.name || humanizedService);
  const description = layer.description || '';
  const abstract =
    description && description.toLowerCase() !== title.toLowerCase() && description.toLowerCase() !== (layer.name || '').toLowerCase()
      ? cleanText(description)
      : '';
  return {
    id: `${ep.id}:${typeName}`,
    source: ep.id,
    province: ep.province,
    typeName,
    title,
    abstract,
    endpoint,
    defaultCrs: arcgisCrs(layer.wkid),
    keywords: keywordsOf(typeName, title),
    verifiedAt: today,
    services: [
      { type: ServiceType.ArcGis, endpoint, typeName, queryable: true },
    ],
  };
}

for (const ep of ENDPOINTS) {
  if (isOnlySkipped(ep.id)) {
    preserveUnchanged(ep);
    continue;
  }

  // ArcGIS REST flow: root + folders of FeatureServer services.
  if (ep.arcgis) {
    const { root, folders } = ep.arcgis;
    try {
      const services = ep.arcgis.services
        ? [...ep.arcgis.services].sort()
        : (await withRetry(() => listArcgisServices(root, folders))).sort();
      if (services.length === 0) {
        throw new Error('no FeatureServer services to index (empty discovery/allowlist)');
      }
      const entries: CatalogEntry[] = [];
      const failedServices: string[] = [];
      const results = await mapPool(services, 3, async (svc): Promise<ArcGisLayerMeta[] | null> => {
        try {
          return await getArcgisLayersCached(root, svc);
        } catch (err) {
          failedServices.push(svc);
          console.error(`${ep.id}: ${svc} FeatureServer metadata FAILED (${err})`);
          return null;
        }
      });
      for (let i = 0; i < services.length; i++) {
        const svcLayers = results[i];
        if (!svcLayers) continue;
        for (const layer of svcLayers) entries.push(arcgisEntry(ep, root, services[i], layer));
      }
      if (entries.length === 0 && failedServices.length > 0) {
        throw new Error(`all ${services.length} FeatureServer services failed`);
      }
      if (failedServices.length > 0) {
        // Partial failure: keep live entries and preserve previous layers for failed service identities only.
        layers.push(...entries);
        const failedSet = new Set(failedServices.map((s) => s.replace(/\/+$/, '')));
        const prevLayers = previous?.layers.filter((l) => l.source === ep.id) ?? [];
        const preservedForFailed: CatalogEntry[] = [];
        const approved = new Set((ep.arcgis.services ?? []).map(allowedArcgisService));
        for (const l of prevLayers) {
          const svc = l.typeName.includes('/') ? l.typeName.slice(0, l.typeName.lastIndexOf('/')) : '';
          if (!failedSet.has(svc)) continue;
          if (approved.size > 0 && !approved.has(svc)) continue;
          if (entries.some((e) => e.id === l.id)) continue;
          preservedForFailed.push({
            ...l,
            services: l.services ?? [{ type: ServiceType.ArcGis, endpoint: l.endpoint, typeName: l.typeName, queryable: true }],
          });
        }
        layers.push(...preservedForFailed);
        preserved += preservedForFailed.length;
        const prevFetched = previous?.sources?.[ep.id]?.fetchedAt;
        sources[ep.id] = {
          status: 'live',
          fetchedAt: new Date().toISOString(),
          failedServices,
          ...(prevFetched ? {} : {}),
        };
        console.log(
          `${ep.id}: ${services.length} FeatureServer services, ${entries.length} live ArcGIS layers, ` +
            `${preservedForFailed.length} preserved from ${failedServices.length} failed services (${failedServices.join(', ')})`,
        );
        continue;
      }
      layers.push(...entries);
      sources[ep.id] = { status: 'live', fetchedAt: new Date().toISOString() };
      console.log(`${ep.id}: ${services.length} FeatureServer services, ${entries.length} ArcGIS layers`);
    } catch (err) {
      preserveFromSnapshot(ep, String(err));
    }
    continue;
  }

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
        const selected = selectWmsLayers(wmsCaps, ep.wmsLayerAllowlist);
        for (const w of selected) {
          const entry = wmsEntry(ep, wmsUrl, w);
          if (ep.coverageNote) {
            entry.abstract = entry.abstract ? `${entry.abstract} ${ep.coverageNote}` : ep.coverageNote;
          }
          entries.push(entry);
        }
        answered += 1;
        console.log(
          `${ep.id}: ${theme} ${wmsCaps.length} WMS layers` +
            (selected !== wmsCaps ? `, ${selected.length} allowlisted` : ''),
        );
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
