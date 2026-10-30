/** Prueba mínima end-to-end contra los servicios reales. Imprime PASS/FAIL por paso con tiempos. */
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

await step('catalogo tiene capas de las 3 fuentes', async () => {
  const c = loadCatalog();
  for (const s of ['geosplan', 'dgct', 'ign']) {
    if (!c.layers.some((l) => l.source === s)) throw new Error(`sin capas de ${s}`);
  }
  console.log(`  (${c.layers.length} capas en catalogo)`);
});

await step("buscar_capas('parcelas') encuentra dgct:parcelas", async () => {
  const hits = searchLayers('parcelas');
  if (!hits.some((h) => h.typeName === 'dgct:parcelas')) throw new Error('dgct:parcelas no aparece');
});

await step("describir_capa('dgct:parcelas') devuelve campos reales", async () => {
  const fields = await describeFeatureType(endpointById('dgct'), 'dgct:parcelas');
  if (fields.length === 0) throw new Error('sin campos');
  console.log(`  (campos: ${fields.map((f) => f.name).join(', ')})`);
});

await step('consultar_capa dgct:parcelas (GetFeature real, 1 feature)', async () => {
  const fc = await getFeature(endpointById('dgct'), 'dgct:parcelas', { maxFeatures: 1, srsName: 'EPSG:4326' });
  if (!fc.features?.length) throw new Error('0 features');
});

await step('consultar_capa geosplan jurisdicciones (GetFeature real)', async () => {
  const fc = await getFeature(endpointById('geosplan'), 'WFS_GEOSPLAN:jurisdicciones', { maxFeatures: 2, srsName: 'EPSG:4326' });
  if (!fc.features?.length) throw new Error('0 features');
  console.log(`  (totalFeatures=${fc.totalFeatures})`);
});

await step('consultar_capa ign area_protegida (GetFeature real)', async () => {
  const fc = await getFeature(endpointById('ign'), 'ign:area_protegida', { maxFeatures: 2, srsName: 'EPSG:4326' });
  if (!fc.features?.length) throw new Error('0 features');
});

await step("geocodificar('Yerba Buena, Tucuman') devuelve lat/lon", async () => {
  const hits = await geocode('Yerba Buena, Tucumán');
  if (!hits.length || hits[0].lat === undefined) throw new Error('sin candidatos con coordenadas');
  console.log(`  (${hits[0].nombre}: ${hits[0].lat}, ${hits[0].lon})`);
});

await step('bbox con CRS explicito devuelve features reales (geosplan EPSG:22183)', async () => {
  const fc = await getFeature(endpointById('geosplan'), 'WFS_GEOSPLAN:jurisdicciones', {
    maxFeatures: 5,
    bbox: [3550000, 7030000, 3600000, 7045000],
    bboxCrs: 'EPSG:22183',
    srsName: 'EPSG:4326',
  });
  if (!fc.features?.length) throw new Error(`bbox devolvio 0 features (totalFeatures=${fc.totalFeatures})`);
  console.log(`  (totalFeatures=${fc.totalFeatures}, devueltos=${fc.features.length})`);
});

await step('bbox 4326 lon,lat con CRS explicito (ign EPSG:4326)', async () => {
  const fc = await getFeature(endpointById('ign'), 'ign:area_protegida', {
    maxFeatures: 5,
    bbox: [-65.5, -27.5, -64.5, -26.5],
    bboxCrs: 'EPSG:4326',
    srsName: 'EPSG:4326',
  });
  if (!fc.features?.length) throw new Error('bbox 4326 en IGN devolvio 0 features');
  console.log(`  (totalFeatures=${fc.totalFeatures}, devueltos=${fc.features.length})`);
});

await step('reproyeccion TM coincide con referencia proj4 (<0.01m)', async () => {
  const origin = lonLatToTransverseMercator(-66, -90, { lon0: -66, falseEasting: 3_500_000 });
  if (Math.abs(origin.x - 3_500_000) > 1e-6 || Math.abs(origin.y) > 1e-6) {
    throw new Error(`origen mal: ${origin.x},${origin.y}`);
  }
  const smt = lonLatToTransverseMercator(-65.2226, -26.8083, { lon0: -66, falseEasting: 3_500_000 });
  if (Math.abs(smt.x - 3577292.58) > 0.01 || Math.abs(smt.y - 7035339.68) > 0.01) {
    throw new Error(`San Miguel de Tucuman mal: ${smt.x},${smt.y}`);
  }
});

await step('reprojectBboxFrom4326 a EPSG:22183 produce envolvente valida', async () => {
  const rb = reprojectBboxFrom4326([-65.35, -26.95, -65.05, -26.65], '22183');
  if (!rb) throw new Error('devolvio null');
  if (!(rb[0] > 3_500_000 && rb[0] < 3_700_000 && rb[2] > rb[0] && rb[3] > rb[1])) {
    throw new Error(`envolvente fuera de rango: ${rb.join(',')}`);
  }
  const identity = reprojectBboxFrom4326([-66, -27, -65, -26], '4326');
  if (!identity || identity[0] !== -66 || identity[3] !== -26) throw new Error('identidad 4326 rota');
});

console.log(failures === 0 ? 'SMOKE OK' : `SMOKE: ${failures} fallas`);
process.exit(failures === 0 ? 0 : 1);
