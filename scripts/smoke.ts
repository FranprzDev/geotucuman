/** Minimal end-to-end test against the real services. Prints PASS/FAIL per step with timings. */
import { loadCatalog, searchLayers } from '../src/catalog.js';
import { endpointById } from '../src/endpoints.js';
import { describeFeatureType, getFeature } from '../src/wfs.js';
import { geocode } from '../src/georef.js';
import { lonLatToTransverseMercator, reprojectBboxFrom4326 } from '../src/projection.js';
import { ServiceType } from '../src/service-type.js';

import { ENDPOINTS } from '../src/endpoints.js';

let failures = 0;

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`PASS ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${name}: ${err}`);
  }
}

await step('catalog has layers from every configured source', async () => {
  const c = loadCatalog();
  for (const ep of ENDPOINTS) {
    if (!c.layers.some((l) => l.source === ep.id)) throw new Error(`no layers from ${ep.id}`);
  }
  console.log(`  (${c.layers.length} layers in catalog)`);
});

await step("search_layers('parcelas', province 'Tucumán') finds dgct:parcelas", async () => {
  const hits = searchLayers('parcelas', 10, undefined, 'Tucumán');
  if (!hits.some((h) => h.typeName === 'dgct:parcelas')) throw new Error('dgct:parcelas does not appear');
});

await step("search_layers('parcelas') spans provinces", async () => {
  const hits = searchLayers('parcelas');
  const provinces = new Set(hits.map((h) => h.province));
  if (provinces.size < 2) throw new Error(`expected hits from several provinces, got ${[...provinces].join(', ')}`);
});

await step("describe_layer('dgct:parcelas') returns real fields", async () => {
  const fields = await describeFeatureType(endpointById('dgct'), 'dgct:parcelas');
  if (fields.length === 0) throw new Error('no fields');
  console.log(`  (fields: ${fields.map((f) => f.name).join(', ')})`);
});

await step('query_layer dgct:parcelas (real GetFeature, 1 feature)', async () => {
  const fc = await getFeature(endpointById('dgct'), 'dgct:parcelas', { maxFeatures: 1, srsName: 'EPSG:4326' });
  if (!fc.features?.length) throw new Error('0 features');
});

await step('query_layer geosplan jurisdicciones (real GetFeature)', async () => {
  const fc = await getFeature(endpointById('geosplan'), 'WFS_GEOSPLAN:jurisdicciones', { maxFeatures: 2, srsName: 'EPSG:4326' });
  if (!fc.features?.length) throw new Error('0 features');
  console.log(`  (totalFeatures=${fc.totalFeatures})`);
});

await step('neuquen WMS GetMap probe (ArcGIS, WMS-only source)', async () => {
  const { getWmsCapabilities, probeWmsGetMap } = await import('../src/wms.js');
  const ep = endpointById('neuquen');
  const caps = await getWmsCapabilities(ep.url);
  if (caps.length === 0) throw new Error('no WMS layers');
  const probe = await probeWmsGetMap(ep.url, caps[0].name, 'EPSG:4326', [-73.6, -41.1, -68.0, -36.4]);
  if (!probe.ok) throw new Error(`GetMap failed: ${probe.detail}`);
});

await step('query_layer ign area_protegida (real GetFeature)', async () => {
  const fc = await getFeature(endpointById('ign'), 'ign:area_protegida', { maxFeatures: 2, srsName: 'EPSG:4326' });
  if (!fc.features?.length) throw new Error('0 features');
});

await step("suggest_layers('riego') finds candidates (embedded catalog)", async () => {
  const { suggestLayersHandler } = await import('../src/tools/suggest_layers.js');
  const r = (await suggestLayersHandler({ goal: 'riego', limit: 5 })) as { candidates?: unknown[] };
  if (!r.candidates || r.candidates.length === 0) throw new Error('no candidates for riego');
});

await step("geocode('Yerba Buena, Tucuman') returns lat/lon", async () => {
  const hits = await geocode('Yerba Buena, Tucumán');
  if (!hits.length || hits[0].lat === undefined) throw new Error('no candidates with coordinates');
  console.log(`  (${hits[0].name}: ${hits[0].lat}, ${hits[0].lon})`);
});

await step('bbox with explicit CRS returns real features (geosplan EPSG:22183)', async () => {
  const fc = await getFeature(endpointById('geosplan'), 'WFS_GEOSPLAN:jurisdicciones', {
    maxFeatures: 5,
    bbox: [3550000, 7030000, 3600000, 7045000],
    bboxCrs: 'EPSG:22183',
    srsName: 'EPSG:4326',
  });
  if (!fc.features?.length) throw new Error(`bbox returned 0 features (totalFeatures=${fc.totalFeatures})`);
  console.log(`  (totalFeatures=${fc.totalFeatures}, returned=${fc.features.length})`);
});

await step('bbox 4326 lon,lat with explicit CRS (ign EPSG:4326)', async () => {
  const fc = await getFeature(endpointById('ign'), 'ign:area_protegida', {
    maxFeatures: 5,
    bbox: [-65.5, -27.5, -64.5, -26.5],
    bboxCrs: 'EPSG:4326',
    srsName: 'EPSG:4326',
  });
  if (!fc.features?.length) throw new Error('bbox 4326 on IGN returned 0 features');
  console.log(`  (totalFeatures=${fc.totalFeatures}, returned=${fc.features.length})`);
});

await step('TM reprojection matches proj4 reference (<0.01m)', async () => {
  const origin = lonLatToTransverseMercator(-66, -90, { lon0: -66, falseEasting: 3_500_000 });
  if (Math.abs(origin.x - 3_500_000) > 1e-6 || Math.abs(origin.y) > 1e-6) {
    throw new Error(`bad origin: ${origin.x},${origin.y}`);
  }
  const smt = lonLatToTransverseMercator(-65.2226, -26.8083, { lon0: -66, falseEasting: 3_500_000 });
  if (Math.abs(smt.x - 3577292.58) > 0.01 || Math.abs(smt.y - 7035339.68) > 0.01) {
    throw new Error(`bad San Miguel de Tucuman: ${smt.x},${smt.y}`);
  }
});

await step('reprojectBboxFrom4326 to EPSG:22183 produces a valid envelope', async () => {
  const rb = reprojectBboxFrom4326([-65.35, -26.95, -65.05, -26.65], '22183');
  if (!rb) throw new Error('returned null');
  if (!(rb[0] > 3_500_000 && rb[0] < 3_700_000 && rb[2] > rb[0] && rb[3] > rb[1])) {
    throw new Error(`envelope out of range: ${rb.join(',')}`);
  }
  const identity = reprojectBboxFrom4326([-66, -27, -65, -26], '4326');
  if (!identity || identity[0] !== -66 || identity[3] !== -26) throw new Error('4326 identity broken');
});

// --- Live ArcGIS checks (real network) ---
await step('Arcgis: listArcgisServices Mendoza Hosted >= 100 services', async () => {
  const { listArcgisServices } = await import('../src/arcgis.js');
  const { ENDPOINTS } = await import('../src/endpoints.js');
  const mendoza = ENDPOINTS.find((e) => e.id === 'mendoza');
  if (!mendoza || !mendoza.arcgis) throw new Error('mendoza endpoint not configured with arcgis');
  const services = await listArcgisServices(mendoza.arcgis.root, mendoza.arcgis.folders);
  const hosted = services.filter((s) => s.startsWith('Hosted/'));
  if (hosted.length < 100) throw new Error(`expected >=100 Hosted services, got ${hosted.length}`);
  console.log(`  (${services.length} services, ${hosted.length} Hosted)`);
});

await step('Arcgis: describe_layer mendoza Hosted/Bomberos/0 returns fields', async () => {
  const { describeLayerHandler } = await import('../src/tools/describe_layer.js');
  const { ENDPOINTS } = await import('../src/endpoints.js');
  const mendoza = ENDPOINTS.find((e) => e.id === 'mendoza');
  if (!mendoza) throw new Error('mendoza endpoint not configured');
  const r = (await describeLayerHandler({ typeName: 'mendoza:Hosted/Bomberos/0' })) as { fields?: unknown[]; error?: string };
  if (r.error) throw new Error(`describe error: ${r.error}`);
  if (!r.fields || r.fields.length === 0) throw new Error('no fields returned');
});

await step('Arcgis: query_layer mendoza Hosted/Bomberos/0 returns 2 WGS84 points in Argentina', async () => {
  const { queryLayerHandler } = await import('../src/tools/query_layer.js');
  const r = (await queryLayerHandler({ ...{startIndex: undefined, bbox: undefined, bboxCrs: undefined}, typeName: 'mendoza:Hosted/Bomberos/0', maxFeatures: 2 })) as {
    features?: Array<{ geometry?: { coordinates?: number[] } }>;
    error?: string;
  };
  if (r.error) throw new Error(`query error: ${r.error}`);
  if (!r.features || r.features.length !== 2) throw new Error(`expected 2 features, got ${r.features?.length ?? 0}`);
  for (const f of r.features) {
    const c = f.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) throw new Error('missing coordinates');
    const lon = c[0]!;
    const lat = c[1]!;
    if (!(lon > -71 && lon < -66)) throw new Error(`lon out of range: ${lon}`);
    if (!(lat > -38 && lat < -31)) throw new Error(`lat out of range: ${lat}`);
  }
});

await step('Arcgis: query_layer startIndex page 2 differs from page 1', async () => {
  const { queryLayerHandler } = await import('../src/tools/query_layer.js');
  const base = { typeName: 'mendoza:Hosted/Bomberos/0', maxFeatures: 2 };
  const p1 = (await queryLayerHandler({ ...{startIndex: undefined, bbox: undefined, bboxCrs: undefined}, ...base, startIndex: 0 })) as { features?: Array<{ id?: unknown; properties?: Record<string, unknown> }>; error?: string };
  const p2 = (await queryLayerHandler({ ...{startIndex: undefined, bbox: undefined, bboxCrs: undefined}, ...base, startIndex: 2 })) as { features?: Array<{ id?: unknown; properties?: Record<string, unknown> }>; error?: string };
  if (p1.error) throw new Error(`page1 error: ${p1.error}`);
  if (p2.error) throw new Error(`page2 error: ${p2.error}`);
  const key = (f: { id?: unknown; properties?: Record<string, unknown> }) => {
    if (f.id !== undefined && f.id !== null) return String(f.id);
    try {
      return JSON.stringify(f.properties ?? {});
    } catch {
      return String(f.id);
    }
  };
  const ids1 = new Set((p1.features ?? []).map(key));
  const ids2 = (p2.features ?? []).map(key);
  if (ids2.length === 0) throw new Error('page2 returned no features');
  if (ids2.every((id) => ids1.has(id))) throw new Error('page2 returned identical IDs to page1');
});

await step('Arcgis: query_layer bbox returns only features inside envelope', async () => {
  const { queryLayerHandler } = await import('../src/tools/query_layer.js');
  const bbox: [number, number, number, number] = [-70, -37, -67, -32];
  const r = (await queryLayerHandler({ ...{startIndex: undefined, bbox: undefined, bboxCrs: undefined}, typeName: 'mendoza:Hosted/Bomberos/0', maxFeatures: 50, bbox })) as {
    features?: Array<{ geometry?: { coordinates?: number[] } }>;
    error?: string;
  };
  if (r.error) throw new Error(`bbox query error: ${r.error}`);
  for (const f of r.features ?? []) {
    const c = f.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const lon = c[0]!;
    const lat = c[1]!;
    if (!(lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3])) {
      throw new Error(`feature outside bbox: ${lon},${lat}`);
    }
  }
});

await step("ArcGIS filter: searchLayers('bomberos', 50, ArcGis, 'Mendoza') nonempty & all arcgis", async () => {
  const hits = searchLayers('bomberos', 50, ServiceType.ArcGis, 'Mendoza');
  if (hits.length === 0) throw new Error('no ArcGIS hits for bomberos in Mendoza');
  for (const h of hits) {
    if (!(h.services ?? []).some((s) => s.type === ServiceType.ArcGis)) {
      throw new Error(`non-ArcGIS entry in results: ${h.id}`);
    }
  }
  console.log(`  (${hits.length} hits)`);
});

await step('WFS filter does not return Mendoza ArcGIS-only entries', async () => {
  const hits = searchLayers('bomberos', 50, ServiceType.Wfs, 'Mendoza');
  for (const h of hits) {
    if (!(h.services ?? []).some((s) => s.type === ServiceType.Wfs)) {
      throw new Error(`non-WFS entry under WFS filter: ${h.id}`);
    }
  }
});

await step('WMS filter does not return Mendoza ArcGIS-only entries', async () => {
  const hits = searchLayers('bomberos', 50, ServiceType.Wms, 'Mendoza');
  for (const h of hits) {
    if (!(h.services ?? []).some((s) => s.type === ServiceType.Wms)) {
      throw new Error(`non-WMS entry under WMS filter: ${h.id}`);
    }
  }
});

console.log(failures === 0 ? 'SMOKE OK' : `SMOKE: ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);