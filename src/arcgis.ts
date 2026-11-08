/**
 * ArcGIS REST (FeatureServer/MapServer) client.
 * Only FeatureServer vector layers with the Query capability are in scope.
 */

const USER_AGENT = 'GeoArg/0.2 (+https://franprzdev.github.io/geotucuman/)';
const TIMEOUT_MS = 20_000;
const MAX_CONCURRENCY = 4;

interface ArcGisErrorBody {
  error: { code: number; message: string; details?: string[] };
}

function isArcGisError(obj: unknown): obj is ArcGisErrorBody {
  return (
    !!obj &&
    typeof obj === 'object' &&
    'error' in obj &&
    !!(obj as { error?: unknown }).error &&
    typeof (obj as { error: { code?: unknown } }).error === 'object'
  );
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 200) {
      // ArcGIS often returns 200 with an error body; only hard fail on non-200.
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
    }
    if (isArcGisError(body)) {
      const e = body.error;
      const detail = e.details && e.details.length > 0 ? ` (${e.details.join('; ')})` : '';
      throw new Error(`ArcGIS error ${e.code}: ${e.message}${detail} [${url}]`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `fn` over `items` with a bounded concurrency and preserves input order. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers: Promise<void>[] = [];
  const n = Math.max(1, Math.min(limit, items.length));
  for (let k = 0; k < n; k++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

function joinUrl(root: string, path: string): string {
  return `${root.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export interface ArcGisFolderContent {
  folders?: string[];
  services?: Array<{ name: string; type: string }>;
}

/**
 * Lists FeatureServer service names inside the given folders.
 * Skips raster-only MapServer services (only FeatureServer entries are returned).
 * Returns names like 'Hosted/Bomberos'.
 */
export async function listArcgisServices(root: string, folders: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const folder of folders) {
    const url = `${joinUrl(root, folder)}?f=json`;
    const body = (await fetchJson(url)) as ArcGisFolderContent;
    for (const svc of body.services ?? []) {
      if (svc.type !== 'FeatureServer') continue;
      out.push(svc.name.startsWith(`${folder}/`) ? svc.name : `${folder}/${svc.name}`);
    }
  }
  return out;
}

export interface ArcGisLayerMeta {
  id: number;
  name: string;
  geometryType?: string;
  description?: string;
  copyrightText?: string;
  wkid?: number;
}

interface ArcGisServiceBody {
  layers?: Array<{ id: number; name: string }>;
  tables?: Array<{ id: number; name: string }>;
  description?: string;
  copyrightText?: string;
  spatialReference?: { wkid?: number; latestWkid?: number };
}

interface ArcGisLayerBody {
  id?: number;
  name?: string;
  geometryType?: string;
  description?: string;
  copyrightText?: string;
  capabilities?: string;
  spatialReference?: { wkid?: number; latestWkid?: number };
}

function pickWkid(sr?: { wkid?: number; latestWkid?: number }): number | undefined {
  if (!sr) return undefined;
  if (typeof sr.wkid === 'number') return sr.wkid;
  if (typeof sr.latestWkid === 'number') return sr.latestWkid;
  return undefined;
}

/**
 * Fetches the layer list of a FeatureServer plus per-layer metadata.
 * Only layers that expose the `Query` capability are returned (raster-only tiles skipped).
 */
export async function getArcgisLayers(root: string, serviceName: string): Promise<ArcGisLayerMeta[]> {
  const svcUrl = `${joinUrl(root, serviceName)}/FeatureServer?f=json`;
  const svcBody = (await fetchJson(svcUrl)) as ArcGisServiceBody;
  const layers = svcBody.layers ?? [];
  const layerIds = layers.map((l) => l.id);
  const metas = await mapPool(layerIds, MAX_CONCURRENCY, async (id) => {
    const url = `${joinUrl(root, serviceName)}/FeatureServer/${id}?f=json`;
    const body = (await fetchJson(url)) as ArcGisLayerBody;
    const caps = (body.capabilities ?? '').toLowerCase();
    if (caps && !caps.split(',').map((c) => c.trim()).includes('query')) {
      return null;
    }
    const meta: ArcGisLayerMeta = {
      id,
      name: body.name ?? layers.find((l) => l.id === id)?.name ?? `Layer ${id}`,
      geometryType: body.geometryType,
      description: body.description || svcBody.description,
      copyrightText: body.copyrightText || svcBody.copyrightText,
      wkid: pickWkid(body.spatialReference) ?? pickWkid(svcBody.spatialReference),
    };
    return meta;
  });
  return metas.filter((m): m is ArcGisLayerMeta => m !== null);
}

export async function getArcgisLayersCached(
  root: string,
  serviceName: string,
): Promise<ArcGisLayerMeta[]> {
  const cachePath = process.env.GEOARG_ARCGIS_CACHE;
  if (!cachePath) {
    return getArcgisLayers(root, serviceName);
  }
  // Lazy import to keep the module free of node:fs in browser-ish contexts.
  const fs = await import('node:fs');
  const key = root + '|' + serviceName;
  let cache: Record<string, ArcGisLayerMeta[]> = {};
  if (fs.existsSync(cachePath)) {
    try {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as Record<string, ArcGisLayerMeta[]>;
    } catch {
      cache = {};
    }
  }
  if (Object.prototype.hasOwnProperty.call(cache, key)) {
    return cache[key];
  }
  const result = await getArcgisLayers(root, serviceName);
  cache[key] = result;
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  return result;
}

export interface ArcGisField {
  name: string;
  type: string;
}

export async function describeArcgisFields(
  root: string,
  serviceName: string,
  layerId: number,
): Promise<ArcGisField[]> {
  const url = `${joinUrl(root, serviceName)}/FeatureServer/${layerId}?f=json`;
  const body = (await fetchJson(url)) as { fields?: Array<{ name: string; type: string }> };
  return (body.fields ?? []).map((f) => ({ name: f.name, type: f.type }));
}

export interface ArcGisQueryOptions {
  maxFeatures?: number;
  startIndex?: number;
  /** Bbox in EPSG:4326 as [minLon, minLat, maxLon, maxLat]. */
  bbox?: [number, number, number, number];
}

export interface ArcGisQueryResult {
  type: 'FeatureCollection';
  features: unknown[];
  totalFeatures: number | null;
}

interface ArcGisCountBody {
  count?: number;
}

/**
 * Queries a FeatureServer layer and returns a GeoJSON FeatureCollection with EPSG:4326 geometries.
 * Uses f=geojson for features, resultRecordCount/resultOffset for paging, and a separate
 * returnCountOnly call to obtain the total (ArcGIS does not return totals with features).
 */
export async function queryArcgis(
  root: string,
  serviceName: string,
  layerId: number,
  opts: ArcGisQueryOptions = {},
): Promise<ArcGisQueryResult> {
  const base = `${joinUrl(root, serviceName)}/FeatureServer/${layerId}/query`;
  const params = new URLSearchParams();
  params.set('where', '1=1');
  params.set('outFields', '*');
  params.set('returnGeometry', 'true');
  params.set('outSR', '4326');
  params.set('f', 'geojson');
  if (typeof opts.maxFeatures === 'number') params.set('resultRecordCount', String(opts.maxFeatures));
  if (typeof opts.startIndex === 'number') params.set('resultOffset', String(opts.startIndex));
  if (opts.bbox) {
    const [minx, miny, maxx, maxy] = opts.bbox;
    params.set('geometry', `${minx},${miny},${maxx},${maxy}`);
    params.set('geometryType', 'esriGeometryEnvelope');
    params.set('inSR', '4326');
    params.set('spatialRel', 'esriSpatialRelIntersects');
  }

  const countParams = new URLSearchParams();
  countParams.set('where', '1=1');
  countParams.set('returnCountOnly', 'true');
  countParams.set('f', 'json');
  if (opts.bbox) {
    for (const [k, v] of params) {
      if (k.startsWith('geometry') || k === 'inSR' || k === 'spatialRel') {
        countParams.set(k, v);
      }
    }
  }

  const [body, countBody] = await Promise.all([
    fetchJson(`${base}?${params.toString()}`),
    fetchJson(`${base}?${countParams.toString()}`),
  ]);

  const fc = body as { type?: string; features?: unknown[] };
  const total = (countBody as ArcGisCountBody).count;
  return {
    type: 'FeatureCollection',
    features: fc.features ?? [],
    totalFeatures: typeof total === 'number' ? total : null,
  };
}
