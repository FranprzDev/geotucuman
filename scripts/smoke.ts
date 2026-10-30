/** Prueba mínima end-to-end contra los servicios reales. Imprime PASS/FAIL por paso con tiempos. */
import { loadCatalog, searchLayers } from '../src/catalog.js';
import { endpointById } from '../src/endpoints.js';
import { describeFeatureType, getFeature } from '../src/wfs.js';
import { geocode } from '../src/georef.js';

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

await step('bbox en CRS nativo (geosplan jurisdicciones)', async () => {
  const fc = await getFeature(endpointById('geosplan'), 'WFS_GEOSPLAN:jurisdicciones', {
    maxFeatures: 1,
    bbox: [3550000, 7030000, 3600000, 7045000],
    srsName: 'EPSG:4326',
  });
  if (!(fc.totalFeatures ?? 0)) throw new Error('bbox devolvio 0');
  console.log(`  (totalFeatures=${fc.totalFeatures})`);
});

console.log(failures === 0 ? 'SMOKE OK' : `SMOKE: ${failures} fallas`);
process.exit(failures === 0 ? 0 : 1);
