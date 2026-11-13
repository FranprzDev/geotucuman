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

// --- The fires contract: honest gap, bridged by relatedTerms ---

{
  const lexical = await suggest('focos de calor en Tucumán');
  assert.ok(lexical.noCoverage.includes('focos'), 'focos must be reported uncovered (English-only MODIS metadata)');
  assert.ok(lexical.noCoverage.includes('calor'), 'calor must be reported uncovered');
  assert.ok(lexical.hint && /relatedTerms/.test(lexical.hint), 'uncovered terms must come with a relatedTerms hint');
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
  // Precision guard: a term absent from the catalog must return nothing,
  // not fuzzy junk.
  assert.equal(searchCatalog('foco', { limit: 5 }).length, 0, '"foco" has no exact/prefix match and must return empty');
  assert.equal(searchCatalog('calor', { limit: 5 }).length, 0, '"calor" must not fuzzy-match color/valor');
}

console.log('SEARCH TESTS OK');
