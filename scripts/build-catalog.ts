/** Generates data/catalog.json from the live GetCapabilities / ArcGIS REST of the official endpoints. */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ENDPOINTS, wmsUrlFor } from '../src/endpoints.js';
import type { EndpointConfig } from '../src/endpoints.js';
import { getCapabilities } from '../src/wfs.js';
import { getWmsCapabilities, selectWmsLayers } from '../src/wms.js';
import type { WmsLayer } from '../src/wms.js';
import { listArcgisServices, getArcgisLayers, mapPool } from '../src/arcgis.js';
import type { ArcGisLayerMeta } from '../src/arcgis.js';
import { isCacheMiss } from '../src/capability-cache.js';
import { ServiceType } from '../src/service-type.js';
import type { Catalog, CatalogEntry } from '../src/catalog.js';

const STOP = new Set(['de', 'la', 'el', 'del', 'y', 'en', 'los', 'las', 'para', 'con']);

/** When set, the build is fully offline and byte-reproducible: it only reads data/capabilities/. */
const FROM_CACHE = process.env.GEOARG_FROM_CACHE === '1';
/** Per-source raw GetCapabilities cache (WFS/WMS XML, ArcGIS REST JSON) plus a _meta.json. */
const CACHE_ROOT = 'data/capabilities';

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

const today = new Date().toISOString().slice(0, 10);

/** verifiedAt stamped on the layers of the source being processed (cache-aware). */
let currentVerifiedAt = today;

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
    verifiedAt: currentVerifiedAt,
    services: [
      { type: ServiceType.Wms, endpoint: wmsUrl, typeName: w.name, crs: w.crs, queryable: w.queryable },
    ],
  };
}

/** One retry with a short pause: several provincial servers answer intermittently. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 2500));
    return fn();
  }
}

/** Offline mode never retries (there is nothing to recover from a cache read). */
function attempt<T>(fn: () => Promise<T>): Promise<T> {
  return FROM_CACHE ? fn() : withRetry(fn);
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
    verifiedAt: currentVerifiedAt,
    services: [
      { type: ServiceType.ArcGis, endpoint, typeName, queryable: true },
    ],
  };
}

// ---------------------------------------------------------------------------
// Capability cache plumbing
// ---------------------------------------------------------------------------

interface SourceMeta {
  source: string;
  fetchedAt: string;
  status: 'live' | 'preserved';
  wmsStatus?: 'live' | 'failed';
  ridesFailedThemes?: string[];
  failedServices?: string[];
  /** Files (relative to the source cache dir) needed to rebuild this source offline. */
  files: string[];
}

/** fetchedAt values read from cache metadata; used to derive a deterministic generatedAt. */
const cacheFetchedAts: string[] = [];

function sanitizeSegment(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'uncached';
}

function cachePath(sourceId: string, file: string): string {
  return `${CACHE_ROOT}/${sourceId}/${file}`;
}

function readSourceMeta(id: string): SourceMeta | null {
  const p = cachePath(id, '_meta.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8')) as SourceMeta;
}

/** In offline mode every file listed by _meta.json must be present; otherwise fail loudly. */
function assertCacheFilesExist(meta: SourceMeta): void {
  const missing = meta.files.filter((f) => !existsSync(cachePath(meta.source, f)));
  if (missing.length > 0) {
    throw new Error(
      `GEOARG_FROM_CACHE=1: missing capability cache file(s) for ${meta.source}: ` +
        missing.map((f) => cachePath(meta.source, f)).join(', '),
    );
  }
}

function writeSourceMeta(id: string, meta: SourceMeta): void {
  mkdirSync(`${CACHE_ROOT}/${id}`, { recursive: true });
  writeFileSync(cachePath(id, '_meta.json'), JSON.stringify(meta, null, 2));
}

/**
 * Prepares a source: in offline mode reads/validates its cache metadata and stamps the
 * cached date on its layers. Returns the metadata (or null when the flag is off).
 */
function beginSource(ep: EndpointConfig): SourceMeta | null {
  if (!FROM_CACHE) {
    currentVerifiedAt = today;
    return null;
  }
  const meta = readSourceMeta(ep.id);
  if (!meta) {
    currentVerifiedAt = today;
    return null;
  }
  assertCacheFilesExist(meta);
  cacheFetchedAts.push(meta.fetchedAt);
  currentVerifiedAt = meta.fetchedAt.slice(0, 10);
  return meta;
}

// ---------------------------------------------------------------------------
// Source flows
// ---------------------------------------------------------------------------

for (const ep of ENDPOINTS) {
  if (isOnlySkipped(ep.id)) {
    preserveUnchanged(ep);
    continue;
  }

  // ArcGIS REST flow: root + folders of FeatureServer services.
  if (ep.arcgis) {
    const { root, folders } = ep.arcgis;
    const meta = beginSource(ep);
    if (FROM_CACHE && !meta) {
      preserveFromSnapshot(ep, 'no capabilities cache for source (GEOARG_FROM_CACHE=1)');
      continue;
    }
    const discoveryFile = cachePath(ep.id, 'arcgis-discovery.json');
    const files: string[] = [];
    try {
      let services: string[];
      if (ep.arcgis.services) {
        services = [...ep.arcgis.services].sort();
      } else {
        services = (
          await attempt(() => listArcgisServices(root, folders, { file: discoveryFile, fromCache: FROM_CACHE }))
        ).sort();
        if (!FROM_CACHE) files.push('arcgis-discovery.json');
      }
      if (services.length === 0) {
        throw new Error('no FeatureServer services to index (empty discovery/allowlist)');
      }
      const entries: CatalogEntry[] = [];
      const failedServices: string[] = [];
      const results = await mapPool(services, 3, async (svc): Promise<ArcGisLayerMeta[] | null> => {
        const bundle = `arcgis-${sanitizeSegment(svc)}.json`;
        if (FROM_CACHE && !meta!.files.includes(bundle)) {
          // Service was already marked failed when the cache was written: replay the failure.
          failedServices.push(svc);
          return null;
        }
        try {
          const svcLayers = await attempt(() =>
            getArcgisLayers(root, svc, { file: cachePath(ep.id, bundle), fromCache: FROM_CACHE }),
          );
          if (!FROM_CACHE) files.push(bundle);
          return svcLayers;
        } catch (err) {
          if (isCacheMiss(err)) throw err;
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
      const fetchedAt = FROM_CACHE ? meta!.fetchedAt : new Date().toISOString();
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
        sources[ep.id] = {
          status: 'live',
          fetchedAt,
          failedServices,
        };
        console.log(
          `${ep.id}: ${services.length} FeatureServer services, ${entries.length} live ArcGIS layers, ` +
            `${preservedForFailed.length} preserved from ${failedServices.length} failed services (${failedServices.join(', ')})`,
        );
        if (!FROM_CACHE) {
          writeSourceMeta(ep.id, { source: ep.id, fetchedAt, status: 'live', failedServices, files });
        }
        continue;
      }
      layers.push(...entries);
      sources[ep.id] = { status: 'live', fetchedAt };
      console.log(`${ep.id}: ${services.length} FeatureServer services, ${entries.length} ArcGIS layers`);
      if (!FROM_CACHE) writeSourceMeta(ep.id, { source: ep.id, fetchedAt, status: 'live', files });
    } catch (err) {
      if (isCacheMiss(err)) throw err;
      preserveFromSnapshot(ep, String(err));
    }
    continue;
  }

  // WMS-only flow: themed ArcGIS services (wmsServices) or a single WMS base (wmsOnly).
  const wmsServices = ep.wmsServices ?? (ep.wmsOnly ? [ep.url] : null);
  if (wmsServices) {
    const meta = beginSource(ep);
    if (FROM_CACHE && !meta) {
      preserveFromSnapshot(ep, 'no capabilities cache for source (GEOARG_FROM_CACHE=1)');
      continue;
    }
    const themed = ep.wmsServices !== undefined;
    const fetchedAt = FROM_CACHE ? meta!.fetchedAt : new Date().toISOString();
    const entries: CatalogEntry[] = [];
    const failedThemes: string[] = [];
    const files: string[] = [];
    let answered = 0;
    for (const wmsUrl of wmsServices) {
      const theme = themeOf(wmsUrl);
      const fileName = themed ? `wms-${sanitizeSegment(theme)}.xml` : 'wms.xml';
      if (FROM_CACHE && !meta!.files.includes(fileName)) {
        failedThemes.push(theme);
        console.error(`${ep.id}: ${theme} not present in capabilities cache`);
        continue;
      }
      try {
        const wmsCaps = await attempt(() =>
          getWmsCapabilities(wmsUrl, { file: cachePath(ep.id, fileName), fromCache: FROM_CACHE }),
        );
        const selected = selectWmsLayers(wmsCaps, ep.wmsLayerAllowlist);
        for (const w of selected) {
          const entry = wmsEntry(ep, wmsUrl, w);
          if (ep.coverageNote) {
            entry.abstract = entry.abstract ? `${entry.abstract} ${ep.coverageNote}` : ep.coverageNote;
          }
          entries.push(entry);
        }
        answered += 1;
        if (!FROM_CACHE) files.push(fileName);
        console.log(
          `${ep.id}: ${theme} ${wmsCaps.length} WMS layers` +
            (selected !== wmsCaps ? `, ${selected.length} allowlisted` : ''),
        );
      } catch (err) {
        if (isCacheMiss(err)) throw err;
        failedThemes.push(theme);
        console.error(`${ep.id}: ${theme} WMS GetCapabilities FAILED on ${today} (${err})`);
      }
    }
    const failedField = failedThemes.length > 0 ? { ridesFailedThemes: failedThemes } : {};
    if (answered > 0) {
      layers.push(...entries);
      sources[ep.id] = {
        status: 'live',
        fetchedAt,
        wmsStatus: 'live',
        ...failedField,
      };
      console.log(`${ep.id}: ${entries.length} WMS layers from ${answered}/${wmsServices.length} theme services`);
      if (!FROM_CACHE) {
        writeSourceMeta(ep.id, {
          source: ep.id,
          fetchedAt,
          status: 'live',
          wmsStatus: 'live',
          ...(failedThemes.length > 0 ? { ridesFailedThemes: failedThemes } : {}),
          files,
        });
      }
    } else {
      preserveFromSnapshot(ep, failedThemes.join(', '), failedThemes);
      if (sources[ep.id]) sources[ep.id].wmsStatus = 'failed';
    }
    continue;
  }

  // WFS flow, with WMS merge for every endpoint that exposes one.
  const meta = beginSource(ep);
  if (FROM_CACHE && !meta) {
    preserveFromSnapshot(ep, 'no capabilities cache for source (GEOARG_FROM_CACHE=1)');
    continue;
  }
  const fetchedAt = FROM_CACHE ? meta!.fetchedAt : new Date().toISOString();
  const files: string[] = [];
  try {
    const caps = await attempt(() =>
      getCapabilities(ep, { file: cachePath(ep.id, 'wfs.xml'), fromCache: FROM_CACHE }),
    );
    if (!FROM_CACHE) files.push('wfs.xml');
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
      verifiedAt: currentVerifiedAt,
      services: [{ type: ServiceType.Wfs, endpoint: ep.url, typeName: c.typeName }],
    }));
    const wmsUrl = wmsUrlFor(ep);
    if (wmsUrl) {
      const wmsCached = !FROM_CACHE || meta!.files.includes('wms.xml');
      if (!wmsCached) {
        sources[ep.id] = { status: 'live', fetchedAt, wmsStatus: 'failed' };
        console.error(`${ep.id}: WMS not present in capabilities cache — keeping WFS layers WFS-only`);
      } else {
        try {
          const wmsCaps = await attempt(() =>
            getWmsCapabilities(wmsUrl, { file: cachePath(ep.id, 'wms.xml'), fromCache: FROM_CACHE }),
          );
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
          if (!FROM_CACHE) files.push('wms.xml');
          sources[ep.id] = { status: 'live', fetchedAt, wmsStatus: 'live' };
          console.log(`${ep.id}: ${caps.length} WFS layers, ${wmsCaps.length} WMS layers`);
        } catch (err) {
          if (isCacheMiss(err)) throw err;
          sources[ep.id] = { status: 'live', fetchedAt, wmsStatus: 'failed' };
          console.error(`${ep.id}: WMS GetCapabilities FAILED on ${today} — keeping WFS layers WFS-only (${err})`);
        }
      }
    } else {
      sources[ep.id] = { status: 'live', fetchedAt };
      console.log(`${ep.id}: ${caps.length} layers`);
    }
    layers.push(...entries);
    if (!FROM_CACHE) {
      const source = sources[ep.id];
      writeSourceMeta(ep.id, {
        source: ep.id,
        fetchedAt,
        status: 'live',
        ...(source.wmsStatus ? { wmsStatus: source.wmsStatus } : {}),
        files,
      });
    }
  } catch (err) {
    if (isCacheMiss(err)) throw err;
    preserveFromSnapshot(ep, String(err));
  }
}

mkdirSync('data', { recursive: true });

// In offline mode generatedAt is derived from the cache so repeated builds are byte-identical.
const generatedAt = FROM_CACHE
  ? cacheFetchedAts.length > 0
    ? cacheFetchedAts.reduce((a, b) => (a > b ? a : b))
    : (previous?.generatedAt ?? new Date(0).toISOString())
  : new Date().toISOString();

const denylist = new Set(
  (JSON.parse(readFileSync('data/layer-denylist.json', 'utf-8')) as { layers: Array<{ id: string }> }).layers.map((l) => l.id),
);
const filteredLayers = layers.filter((l) => !denylist.has(l.id));
if (filteredLayers.length !== layers.length) {
  console.log(`layer-denylist: removed ${layers.length - filteredLayers.length} known-broken layers`);
}

const catalog: Catalog = { generatedAt, sources, layers: filteredLayers };
writeFileSync('data/catalog.json', JSON.stringify(catalog, null, 2));
console.log(`data/catalog.json: ${filteredLayers.length} total layers${preserved ? ` (${preserved} preserved from previous snapshot)` : ''}`);
if (FROM_CACHE) console.log(`GEOARG_FROM_CACHE=1: rebuilt offline from ${CACHE_ROOT}/ (generatedAt ${generatedAt})`);
