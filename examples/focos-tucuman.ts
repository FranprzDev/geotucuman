/**
 * Applied example: heat foci vs water in Tucumán.
 *
 * Loads the CONAE national heat-foci WFS (VIIRS + MODIS, last 24 h) and the
 * RIDES water-infrastructure layers (ArcGIS REST) for Tucumán, then computes,
 * in plain TypeScript with no dependencies: distance from each foco to the
 * nearest water well and to the nearest water body/course, and whether the
 * foco falls inside a river-basin polygon.
 *
 * CONAE geo-blocks some foreign IPs; when the live request fails (or with
 * --offline) it falls back to the committed fixtures under examples/fixtures/.
 * RIDES is reachable and is fetched live; fixtures exist for the same fallback.
 *
 * Outputs:
 *   examples/out/focos-tucuman-result.json  (focos + summary + provenance)
 *   docs/ejemplos/focos-tucuman.html        (static Leaflet page)
 * and prints a short Spanish report to stdout.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { buildExamplePage } from '../scripts/build-example-page.js';
import type {
  ExampleResult,
  FocoResult,
  Sensor,
  SourceProvenance,
  Summary,
} from '../scripts/build-example-page.js';

// ---------------------------------------------------------------------------
// Types (minimal GeoJSON)
// ---------------------------------------------------------------------------

type Position = [number, number];

type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'MultiPoint'; coordinates: Position[] }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }
  | null;

interface Feature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: Geometry;
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

interface EsriResponse {
  features?: Array<{ attributes?: Record<string, unknown>; geometry?: Record<string, unknown> }>;
  error?: { code?: number; message?: string };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO = 'https://github.com/FranprzDev/geotucuman';
const BBOX: [number, number, number, number] = [-66.4, -28.7, -64.4, -25.9];

const CONAE_WFS = 'https://geoservicios.conae.gov.ar/geoserver/GeoServiciosCONAE/wfs';
const CONAE_LAYERS: Record<Sensor, string> = {
  VIIRS: 'GeoServiciosCONAE:FocosDeCalorVIIRS',
  MODIS: 'GeoServiciosCONAE:FocosDeCalor',
};

// RIDES publishes these layers as ArcGIS REST. The *_WMS service is display-only
// (its query endpoint returns no geometry), so data is read from *_WFS MapServer.
const RIDES_REST =
  'https://gis.producciontucuman.gob.ar/ArcGIS/rest/services/Recursos_Hidricos_WFS/MapServer';

interface RidesLayer {
  id: number;
  key: string;
  label: string;
  fixture: string;
  simplify: boolean;
}

const RIDES_LAYERS: RidesLayer[] = [
  { id: 2, key: 'pozos', label: 'RIDES · Pozos de agua', fixture: 'rides-pozos.geojson', simplify: false },
  { id: 3, key: 'canales', label: 'RIDES · Canales', fixture: 'rides-canales.geojson', simplify: true },
  { id: 4, key: 'rios', label: 'RIDES · Ríos', fixture: 'rides-rios.geojson', simplify: true },
  { id: 5, key: 'cuerpos', label: 'RIDES · Cuerpos de agua', fixture: 'rides-cuerpos.geojson', simplify: true },
  { id: 6, key: 'cuencas', label: 'RIDES · Cuencas hídricas', fixture: 'rides-cuencas.geojson', simplify: true },
];

const FIXTURES_DIR = 'examples/fixtures';
const OUT_JSON = 'examples/out/focos-tucuman-result.json';
const OUT_HTML = 'docs/ejemplos/focos-tucuman.html';

const WATER_LAYER_KEYS = new Set(['canales', 'rios', 'cuerpos']);
const WATER_KIND: Record<string, string> = {
  canales: 'Canal',
  rios: 'Río',
  cuerpos: 'Cuerpo de agua',
};

// ---------------------------------------------------------------------------
// Fetch with timeout and fixture fallback
// ---------------------------------------------------------------------------

async function fetchJson(url: string, timeoutMs = 25000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'GeoArg-example/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function readFixture<T>(file: string): T {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}/${file}`, 'utf-8')) as T;
}

function conaeUrl(sensor: Sensor): string {
  const params = new URLSearchParams({
    service: 'WFS',
    request: 'GetFeature',
    version: '1.1.0',
    typeName: CONAE_LAYERS[sensor],
    maxFeatures: '500',
    outputFormat: 'application/json',
    // URLSearchParams encodes the bbox commas, as required by GeoServer.
    bbox: `${BBOX.join(',')},EPSG:4326`,
  });
  return `${CONAE_WFS}?${params.toString()}`;
}

function ridesUrl(layer: RidesLayer): string {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });
  // Generalize vertices (~55 m) so line/polygon payloads stay small; the
  // service does not support f=geojson output.
  if (layer.simplify) params.set('maxAllowableOffset', '0.0005');
  return `${RIDES_REST}/${layer.id}/query?${params.toString()}`;
}

function esriToGeoJSON(esri: EsriResponse): FeatureCollection {
  const features: Feature[] = (esri.features ?? []).map((f) => {
    const g = f.geometry ?? {};
    let geometry: Geometry = null;
    if (typeof g.x === 'number' && typeof g.y === 'number') {
      geometry = { type: 'Point', coordinates: [g.x, g.y] };
    } else if (Array.isArray(g.paths)) {
      geometry = { type: 'MultiLineString', coordinates: g.paths as Position[][] };
    } else if (Array.isArray(g.rings)) {
      const rings = g.rings as Position[][];
      geometry =
        rings.length === 1
          ? { type: 'Polygon', coordinates: [rings[0]] }
          : { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) };
    }
    return { type: 'Feature', properties: f.attributes ?? {}, geometry };
  });
  return { type: 'FeatureCollection', features };
}

interface Loaded {
  features: Feature[];
  provenance: SourceProvenance;
}

interface ConaeLoad extends Loaded {
  sensor: Sensor;
}

async function loadConae(sensor: Sensor, offline: boolean): Promise<ConaeLoad> {
  const url = conaeUrl(sensor);
  const file = `focos-${sensor.toLowerCase()}.geojson`;
  const label = `CONAE · Focos de calor ${sensor}`;
  let note: string | undefined;

  if (!offline) {
    try {
      const raw = (await fetchJson(url)) as FeatureCollection;
      const features = raw.features ?? [];
      const dataDate = latestDate(features);
      return {
        sensor,
        features,
        provenance: {
          id: `conae-${sensor.toLowerCase()}`,
          label,
          kind: 'live',
          url,
          fetchedAt: new Date().toISOString(),
          dataDate,
          features: features.length,
        },
      };
    } catch (err) {
      note = `sin acceso en vivo (${(err as Error).message}); se usó el fixture versionado`;
    }
  } else {
    note = 'modo --offline: se usó el fixture versionado';
  }

  const fc = readFixture<FeatureCollection>(file);
  const features = fc.features ?? [];
  return {
    sensor,
    features,
    provenance: {
      id: `conae-${sensor.toLowerCase()}`,
      label,
      kind: 'fixture',
      url,
      fetchedAt: null,
      dataDate: latestDate(features),
      features: features.length,
      note,
    },
  };
}

async function loadRides(layer: RidesLayer, offline: boolean): Promise<Loaded> {
  const url = ridesUrl(layer);
  let note: string | undefined;

  if (!offline) {
    try {
      const raw = (await fetchJson(url)) as EsriResponse;
      if (raw.error) throw new Error(raw.error.message ?? 'ArcGIS error');
      const fc = esriToGeoJSON(raw);
      return {
        features: fc.features,
        provenance: {
          id: `rides-${layer.key}`,
          label: layer.label,
          kind: 'live',
          url,
          fetchedAt: new Date().toISOString(),
          dataDate: null,
          features: fc.features.length,
        },
      };
    } catch (err) {
      note = `sin acceso en vivo (${(err as Error).message}); se usó el fixture versionado`;
    }
  } else {
    note = 'modo --offline: se usó el fixture versionado';
  }

  const fc = readFixture<FeatureCollection>(layer.fixture);
  return {
    features: fc.features ?? [],
    provenance: {
      id: `rides-${layer.key}`,
      label: layer.label,
      kind: 'fixture',
      url,
      fetchedAt: null,
      dataDate: null,
      features: (fc.features ?? []).length,
      note,
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers (no dependencies)
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in km between two [lon, lat] positions. */
function haversineKm(a: Position, b: Position): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance in km from point p to segment ab, using a local equirectangular
 * projection centred on p (accurate at the scales of this example).
 */
function pointSegmentKm(p: Position, a: Position, b: Position): number {
  const cosLat = Math.cos(toRad(p[1]));
  const project = (c: Position): [number, number] => [
    (c[0] - p[0]) * toRad(1) * cosLat * EARTH_RADIUS_KM,
    (c[1] - p[1]) * toRad(1) * EARTH_RADIUS_KM,
  ];
  const [ax, ay] = project(a);
  const [bx, by] = project(b);
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(ax, ay);
  let t = (-ax * dx - ay * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function lineDistanceKm(p: Position, line: Position[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineKm(p, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    best = Math.min(best, pointSegmentKm(p, line[i - 1], line[i]));
  }
  return best;
}

/** Distance in km from a point to any part of a geometry (0 if inside a polygon). */
function distanceToGeometryKm(p: Position, geometry: Geometry): number {
  if (!geometry) return Infinity;
  switch (geometry.type) {
    case 'Point':
      return haversineKm(p, geometry.coordinates);
    case 'MultiPoint':
      return geometry.coordinates.reduce((min, c) => Math.min(min, haversineKm(p, c)), Infinity);
    case 'LineString':
      return lineDistanceKm(p, geometry.coordinates);
    case 'MultiLineString':
      return geometry.coordinates.reduce((min, line) => Math.min(min, lineDistanceKm(p, line)), Infinity);
    case 'Polygon': {
      if (pointInRings(p, geometry.coordinates)) return 0;
      return geometry.coordinates.reduce((min, ring) => Math.min(min, lineDistanceKm(p, ring)), Infinity);
    }
    case 'MultiPolygon': {
      let best = Infinity;
      for (const polygon of geometry.coordinates) {
        if (pointInRings(p, polygon)) return 0;
        best = Math.min(best, polygon.reduce((min, ring) => Math.min(min, lineDistanceKm(p, ring)), Infinity));
      }
      return best;
    }
  }
}

/** Even-odd point-in-polygon across all rings of a Polygon/MultiPolygon. */
function pointInRings(p: Position, rings: Position[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersects =
        yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
  }
  return inside;
}

function pointInGeometry(p: Position, geometry: Geometry): boolean {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInRings(p, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInRings(p, polygon));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function latestDate(features: Feature[]): string | null {
  let latest: string | null = null;
  for (const f of features) {
    const d = str(f.properties.Dia);
    if (d && (!latest || d > latest)) latest = d;
  }
  return latest;
}

function nameOf(props: Record<string, unknown>): string | null {
  for (const key of ['Nombre', 'nombre', 'NOMBRE', 'Etiqueta', 'Cuenca_alt', 'Subcuenca', 'Descripcion']) {
    const v = str(props[key]);
    if (v) return v;
  }
  return null;
}

// The RIDES layers repeat a generic label on many records; those add no value.
const GENERIC_NAMES = new Set(['pozos de agua', 'cuerpo de agua']);

function usefulName(props: Record<string, unknown>): string | null {
  const name = nameOf(props);
  return name && !GENERIC_NAMES.has(name.toLowerCase()) ? name : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(n: number, digits = 2): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

interface WaterFeature {
  geometry: Geometry;
  name: string | null;
  kind: string;
}

function distribution(values: number[]): Summary['distanceToNearestPozoKm'] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: null, median: null, max: null };
  return {
    min: round(Math.min(...finite)),
    median: round(median(finite) ?? Math.min(...finite)),
    max: round(Math.max(...finite)),
  };
}

function analyze(
  conae: ConaeLoad[],
  rides: Map<string, Feature[]>,
): { focos: FocoResult[]; summary: Summary } {
  const pozos = rides.get('pozos') ?? [];
  const cuencas = rides.get('cuencas') ?? [];
  const water: WaterFeature[] = [];
  for (const [key, features] of rides) {
    if (!WATER_LAYER_KEYS.has(key)) continue;
    const kind = WATER_KIND[key] ?? key;
    for (const f of features) water.push({ geometry: f.geometry, name: usefulName(f.properties), kind });
  }

  const pozosPoints = pozos
    .map((f) => ({ coord: f.geometry?.type === 'Point' ? f.geometry.coordinates : null, name: usefulName(f.properties) }))
    .filter((p): p is { coord: Position; name: string | null } => p.coord != null);

  const focos: FocoResult[] = [];
  for (const { sensor, features } of conae) {
    for (const f of features) {
      if (f.geometry?.type !== 'Point') continue;
      const coord = f.geometry.coordinates;

      let nearestPozo: { d: number; name: string | null } | null = null;
      for (const pozo of pozosPoints) {
        const d = haversineKm(coord, pozo.coord);
        if (!nearestPozo || d < nearestPozo.d) nearestPozo = { d, name: pozo.name };
      }

      let nearestWater: { d: number; name: string | null; kind: string } | null = null;
      for (const w of water) {
        const d = distanceToGeometryKm(coord, w.geometry);
        if (!nearestWater || d < nearestWater.d) nearestWater = { d, name: w.name, kind: w.kind };
      }

      let insideCuenca = false;
      let cuencaName: string | null = null;
      for (const c of cuencas) {
        if (pointInGeometry(coord, c.geometry)) {
          insideCuenca = true;
          cuencaName = nameOf(c.properties);
          break;
        }
      }

      focos.push({
        sensor,
        instrument: str(f.properties.Instrumento) ?? sensor,
        satellite: str(f.properties.Satelite) ?? 's/d',
        date: str(f.properties.Dia),
        time: str(f.properties.Hora),
        lon: coord[0],
        lat: coord[1],
        confidence: num(f.properties.FP_Confidence),
        distanceToNearestPozoKm: nearestPozo ? round(nearestPozo.d) : null,
        nearestPozoName: nearestPozo?.name ?? null,
        distanceToNearestWaterKm: nearestWater ? round(nearestWater.d) : null,
        nearestWaterName: nearestWater?.name ?? null,
        nearestWaterKind: nearestWater?.kind ?? null,
        insideCuenca,
        cuencaName,
      });
    }
  }

  const pozoDistances = focos.map((f) => f.distanceToNearestPozoKm).filter((v): v is number => v != null);
  const waterDistances = focos.map((f) => f.distanceToNearestWaterKm).filter((v): v is number => v != null);
  const insideCount = focos.filter((f) => f.insideCuenca).length;

  const summary: Summary = {
    totalFocos: focos.length,
    perSensor: {
      VIIRS: focos.filter((f) => f.sensor === 'VIIRS').length,
      MODIS: focos.filter((f) => f.sensor === 'MODIS').length,
    },
    insideCuenca: insideCount,
    insideCuencaPct: focos.length > 0 ? round((insideCount / focos.length) * 100, 1) : 0,
    distanceToNearestPozoKm: distribution(pozoDistances),
    distanceToNearestWaterKm: distribution(waterDistances),
    rides: {
      pozos: pozos.length,
      canales: (rides.get('canales') ?? []).length,
      rios: (rides.get('rios') ?? []).length,
      cuerpos: (rides.get('cuerpos') ?? []).length,
      cuencas: cuencas.length,
    },
  };

  return { focos, summary };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(result: ExampleResult, elapsedMs: number): void {
  const s = result.summary;
  const dates = [...new Set(result.focos.map((f) => f.date).filter((d): d is string => Boolean(d)))].sort();
  const lines: string[] = [];
  lines.push('Focos de calor vs agua en Tucumán');
  lines.push(`Generado: ${result.generatedAt} (${Math.round(elapsedMs)} ms)`);
  lines.push('');
  lines.push('Fuentes:');
  for (const p of result.provenance) {
    const kind = p.kind === 'live' ? 'en vivo' : 'fixture';
    const date = p.dataDate ? ` · dato ${p.dataDate}` : '';
    const note = p.note ? ` — ${p.note}` : '';
    lines.push(`  - ${p.label}: ${kind}, ${p.features} registros${date}${note}`);
  }
  lines.push('');
  lines.push(`Focos 24 h: ${s.totalFocos} (VIIRS ${s.perSensor.VIIRS}, MODIS ${s.perSensor.MODIS})`);
  if (dates.length > 0) lines.push(`Fecha de los focos: ${dates.join(', ')}`);
  lines.push(`Dentro de cuenca hídrica: ${s.insideCuenca}/${s.totalFocos} (${s.insideCuencaPct}%)`);
  lines.push(
    `Distancia al pozo más cercano (km): min ${s.distanceToNearestPozoKm.min ?? 's/d'}, ` +
      `mediana ${s.distanceToNearestPozoKm.median ?? 's/d'}, max ${s.distanceToNearestPozoKm.max ?? 's/d'}`,
  );
  lines.push(
    `Distancia al agua más cercana (km): min ${s.distanceToNearestWaterKm.min ?? 's/d'}, ` +
      `mediana ${s.distanceToNearestWaterKm.median ?? 's/d'}, max ${s.distanceToNearestWaterKm.max ?? 's/d'}`,
  );
  lines.push(
    `RIDES: ${s.rides.pozos} pozos, ${s.rides.canales} canales, ${s.rides.rios} ríos, ` +
      `${s.rides.cuerpos} cuerpos, ${s.rides.cuencas} cuencas`,
  );
  lines.push('');
  lines.push(`JSON: ${OUT_JSON}`);
  lines.push(`Página: ${OUT_HTML}`);
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const started = performance.now();
  const offline = process.argv.includes('--offline');

  const [viirs, modis] = await Promise.all([
    loadConae('VIIRS', offline),
    loadConae('MODIS', offline),
  ]);

  const ridesEntries = await Promise.all(
    RIDES_LAYERS.map(async (layer) => [layer.key, await loadRides(layer, offline)] as const),
  );
  const rides = new Map<string, Loaded>();
  for (const [key, loaded] of ridesEntries) rides.set(key, loaded);

  const { focos, summary } = analyze(
    [viirs, modis],
    new Map([...rides].map(([key, loaded]) => [key, loaded.features])),
  );

  const result: ExampleResult = {
    generatedAt: new Date().toISOString(),
    bbox: BBOX,
    provenance: [viirs.provenance, modis.provenance, ...ridesEntries.map(([, l]) => l.provenance)],
    focos,
    summary,
  };

  mkdirSync('examples/out', { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(result, null, 2)}\n`);

  mkdirSync('docs/ejemplos', { recursive: true });
  writeFileSync(OUT_HTML, buildExamplePage(result));

  printReport(result, performance.now() - started);
}

main().catch((err) => {
  console.error(err);
  console.error(`Repo: ${REPO}`);
  process.exit(1);
});
