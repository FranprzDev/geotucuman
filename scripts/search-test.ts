/**
 * Offline relevance tests for the catalog search engine (MiniSearch-based,
 * src/search.ts). No network access; asserts the general ranking mechanism
 * covers the themes the old per-topic synonym lists covered, plus the
 * bilingual fires contract. Run in CI (validate workflow).
 */
import assert from 'node:assert/strict';
import { searchLayers } from '../src/catalog.js';
import { searchCatalog } from '../src/search.js';
import { suggestLayersHandler } from '../src/tools/suggest_layers.js';
import { ServiceType } from '../src/service-type.js';

type Candidate = { typeName: string };

async function suggest(goal: string, relatedTerms?: string[], limit = 10) {
  return (await suggestLayersHandler({ goal, relatedTerms, limit })) as {
    candidates: Candidate[];
    noCoverage: string[];
    hint?: string;
  };
}

// --- General topics, no per-topic lists involved ---

{
  const r = await suggest('quiero armar un mapa de riego y pozos');
  assert.ok(r.candidates.some((c) => /pozo/i.test(c.typeName)), 'riego y pozos: expected a pozos layer');
  assert.ok(r.candidates.some((c) => /riego|canales/i.test(c.typeName)), 'riego y pozos: expected a riego/canales layer');
}

{
  const r = await suggest('población por radio censal');
  assert.ok(r.candidates.some((c) => /radio.*censal|censal.*radio/i.test(c.typeName + c.typeName)), 'radios censales');
}

{
  const r = await suggest('curvas de nivel y elevación');
  assert.ok(r.candidates.some((c) => /curva|nivel/i.test(c.typeName)), 'curvas de nivel');
}

{
  const r = await suggest('soja');
  assert.ok(r.candidates.some((c) => /soja/i.test(c.typeName)), 'soja');
}

{
  const r = await suggest('áreas protegidas');
  assert.ok(r.candidates.some((c) => /area_protegida|areas_protegidas|protegida/i.test(c.typeName)), 'áreas protegidas');
}

{
  const r = await suggest('rutas nacionales');
  assert.ok(r.candidates.some((c) => /ruta/i.test(c.typeName)), 'rutas');
}

{
  const r = await suggest('aeropuertos');
  assert.ok(r.candidates.some((c) => /aeropuerto/i.test(c.typeName)), 'aeropuertos');
}

// --- Word forms without synonym lists (plural/morphology handled generally) ---

{
  const r = await suggest('quemas');
  assert.ok(r.candidates.some((c) => /quemada/i.test(c.typeName)), '"quemas" should reach area_quemada layers');
}

{
  const r = await suggest('incendios');
  assert.ok(r.candidates.some((c) => /incendio/i.test(c.typeName)), '"incendios" should reach incendio layers');
}

// --- Spanish morphology: real stemming bridges inflection and derivation ---

{
  const r = (await suggestLayersHandler({ goal: 'zonas inundables', limit: 20 })) as {
    candidates: Array<{ title: string }>;
  };
  assert.ok(
    r.candidates.some((c) => /Zonas de Inundabilidad/i.test(c.title)),
    '"zonas inundables" must reach the layer titled "Zonas de Inundabilidad"',
  );
  const hits = searchCatalog('zonas inundables', { limit: 20 });
  assert.ok(
    hits.some((h) => /Zonas de Inundabilidad/i.test(h.entry.title)),
    '"zonas inundables" must find a layer titled "Zonas de Inundabilidad"',
  );
  const plural = searchCatalog('inundaciones', { limit: 20 });
  const singular = searchCatalog('inundacion', { limit: 20 });
  assert.ok(plural.length > 0 && singular.length > 0, 'inundación/inundaciones must both match');
}

// --- The fires contract: the canonical miss, fixed by report-driven aliases ---

{
  // "focos de calor" only existed as English MODIS metadata ("fires/hotspots");
  // the miss-report loop (report_miss -> issue -> auto-fix) added "calor" and
  // "focos" to data/layer-aliases.json, so the lexical query now finds it.
  const lexical = await suggest('focos de calor en Tucumán');
  assert.ok(!lexical.noCoverage.includes('focos'), 'focos is now covered by layer aliases');
  assert.ok(!lexical.noCoverage.includes('calor'), 'calor is now covered by layer aliases');
  assert.ok(
    lexical.candidates.some((c) => /fires_modis/i.test(c.typeName)),
    'MODIS fires must appear via aliases without relatedTerms',
  );
  assert.ok(
    !lexical.candidates.some((c) => /color|valor/i.test(c.typeName)),
    'short-term fuzzy collisions (calor->color/valor) must not leak into candidates',
  );

  const expanded = await suggest('focos de calor en Tucumán', ['incendio', 'fire', 'hotspot', 'MODIS', 'VIIRS']);
  assert.ok(
    expanded.candidates.slice(0, 4).some((c) => /fires_modis/i.test(c.typeName)),
    'MODIS fires must rank top once relatedTerms are provided',
  );
  assert.ok(
    expanded.candidates.some((c) => /incendio|quemada/i.test(c.typeName)),
    'Spanish incendio/quemada layers must appear once relatedTerms are provided',
  );
}

// --- search_layers wrapper keeps filters working ---

{
  const hits = searchLayers('parcelas', 10, undefined, 'Tucumán');
  assert.ok(hits.some((h) => h.typeName === 'dgct:parcelas'), 'searchLayers parcelas in Tucumán');

  const arcgis = searchLayers('bomberos', 50, ServiceType.ArcGis, 'Mendoza');
  assert.ok(arcgis.length > 0, 'ArcGIS bomberos in Mendoza');
  for (const h of arcgis) {
    assert.ok(
      (h.services ?? []).some((s) => s.type === ServiceType.ArcGis),
      `non-ArcGIS entry under ArcGIS filter: ${h.id}`,
    );
  }
}

{
  // Layer aliases (data/layer-aliases.json) merge into each layer's keywords
  // at load time: the reported miss "focos de calor" must now find the MODIS
  // fires layers, which the catalog metadata only describes in English.
  const hits = searchCatalog('focos de calor', { limit: 5 });
  assert.ok(hits.some((h) => /fires_modis/.test(h.entry.id)), 'alias: "focos de calor" must find the MODIS fires layers');
}

{
  // Precision guard: aliased terms match only their layers, never fuzzy junk
  // ("calor" must still not fuzzy-match color/valor).
  const foco = searchCatalog('foco', { limit: 5 });
  assert.ok(foco.length > 0, '"foco" must prefix-match the aliased "focos"');
  assert.ok(foco.every((h) => h.entry.id.startsWith('dgct:fires_modis')), '"foco" must match only the aliased MODIS fires layers');
  const calor = searchCatalog('calor', { limit: 5 });
  assert.ok(calor.length > 0, '"calor" must match the aliased MODIS fires layers');
  assert.ok(calor.every((h) => h.entry.id.startsWith('dgct:fires_modis')), '"calor" must match only fires layers, not color/valor fuzzy junk');
}

console.log('SEARCH TESTS OK');
