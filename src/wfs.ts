import type { EndpointConfig } from './endpoints.js';

const TIMEOUT_MS = 20_000;

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    const msg = err instanceof Error && err.name === 'AbortError' ? `timeout>${TIMEOUT_MS}ms` : String(err);
    throw new Error(`WFS request fallo (${url.slice(0, 120)}...): ${msg}`);
  } finally {
    clearTimeout(t);
  }
}

export interface CapabilityLayer {
  typeName: string;
  title: string;
  abstract: string;
  defaultCrs: string;
}

/** Parsea GetCapabilities sin dependencias XML (los GeoServer de Tucuman son de formato poco estricto). */
export async function getCapabilities(ep: EndpointConfig): Promise<CapabilityLayer[]> {
  const url = `${ep.url}?service=WFS&request=GetCapabilities&version=${ep.wfsVersion}`;
  const xml = await fetchText(url);
  const blocks = xml.match(/<FeatureType[^>]*>[\s\S]*?<\/FeatureType>/g) ?? [];
  const pick = (b: string, tag: string) => {
    const m = b.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : '';
  };
  return blocks.map((b) => ({
    typeName: pick(b, 'Name'),
    title: pick(b, 'Title'),
    abstract: pick(b, 'Abstract'),
    // WFS 1.x usa <SRS> o <DefaultCRS>; WFS 2.0 usa <DefaultCRS>
    defaultCrs: pick(b, 'DefaultCRS') || pick(b, 'DefaultSRS') || pick(b, 'SRS'),
  })).filter((l) => l.typeName);
}

export interface FieldInfo {
  name: string;
  type: string;
}

export async function describeFeatureType(ep: EndpointConfig, typeName: string): Promise<FieldInfo[]> {
  const typeParam = ep.wfsVersion === '2.0.0' ? 'typeNames' : 'typeName';
  const url = `${ep.url}?service=WFS&version=${ep.wfsVersion}&request=DescribeFeatureType&${typeParam}=${encodeURIComponent(typeName)}`;
  const xml = await fetchText(url);
  const fields: FieldInfo[] = [];
  const re = /<xsd:element[^>]*name="([^"]+)"[^>]*type="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(xml)) !== null) fields.push({ name: m[1], type: m[2] });
  return fields;
}

export interface GetFeatureOptions {
  maxFeatures?: number;
  startIndex?: number;
  /** bbox en el CRS declarado en bboxCrs. VERIFICADO: los servidores filtran en el CRS
   *  nativo de la capa; un bbox 4326 sobre capa proyectada devuelve 0. Reproyectar antes. */
  bbox?: [number, number, number, number];
  bboxCrs?: string;
  srsName?: string;
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  totalFeatures?: number;
  features: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export async function getFeature(
  ep: EndpointConfig,
  typeName: string,
  opts: GetFeatureOptions = {},
): Promise<GeoJsonFeatureCollection> {
  const typeParam = ep.wfsVersion === '2.0.0' ? 'typeNames' : 'typeName';
  const params = new URLSearchParams({
    service: 'WFS',
    version: ep.wfsVersion,
    request: 'GetFeature',
    [typeParam]: typeName,
    outputFormat: 'application/json',
  });
  params.set(ep.countParam, String(opts.maxFeatures ?? 5));
  if (opts.startIndex !== undefined) params.set('startIndex', String(opts.startIndex));
  if (opts.srsName) params.set('srsName', opts.srsName);
  if (opts.bbox) {
    let bbox = opts.bbox.join(',');
    if (opts.bboxCrs) bbox += `,${opts.bboxCrs}`;
    params.set('bbox', bbox);
  }
  const text = await fetchText(`${ep.url}?${params.toString()}`);
  try {
    return JSON.parse(text) as GeoJsonFeatureCollection;
  } catch {
    throw new Error(`GetFeature ${typeName}: respuesta no-JSON (${text.slice(0, 200)})`);
  }
}
