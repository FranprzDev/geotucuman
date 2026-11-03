/** Minimal end-to-end test against the real services. Prints PASS/FAIL per step with timings. */
import { loadCatalog, searchLayers } from '../src/catalog.js';
import { endpointById } from '../src/endpoints.js';
import { describeFeatureType, getFeature } from '../src/wfs.js';
import { geocode } from '../src/georef.js';
import { lonLatToTransverseMercator, reprojectBboxFrom4326 } from '../src/projection.js';

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

await step('catalog has layers from the 3 sources', async () => {
  const c = loadCatalog();
  for (const s of ['geosplan', 'dgct', 'ign']) {
    if (!c.layers.some((l) => l.source === s)) throw new Error(`no layers from ${s}`);
  }
  console.log(`  (${c.layers.length} layers in catalog)`);
});

await step("search_layers('parcelas') finds dgct:parcelas", async () => {
  const hits = searchLayers('parcelas');
  if (!hits.some((h) => h.typeName === 'dgct:parcelas')) throw new Error('dgct:parcelas does not appear');
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

await step('query_layer ign area_protegida (real GetFeature)', async () => {
  const fc = await getFeature(endpointById('ign'), 'ign:area_protegida', { maxFeatures: 2, srsName: 'EPSG:4326' });
  if (!fc.features?.length) throw new Error('0 features');
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

console.log(failures === 0 ? 'SMOKE OK' : `SMOKE: ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
