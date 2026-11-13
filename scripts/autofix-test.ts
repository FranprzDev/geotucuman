/**
 * Offline tests for the miss-report auto-fix gate (src/lib/autofix.ts).
 * Uses the real catalog search engine; no network access.
 */
import assert from 'node:assert/strict';
import { searchCatalog } from '../src/search.js';
import { selectFix, aliasTerms, parseReport, MIN_SCORE, MAX_GROUP } from '../src/lib/autofix.js';
import type { ScoredLayer } from '../src/lib/autofix.js';

function decide(query: string, expansionText: string, tried: string[] = []) {
  const original: ScoredLayer[] = searchCatalog(query, { limit: 20 }).map((h) => ({ id: h.entry.id, source: h.entry.source, score: h.score }));
  const expansion: ScoredLayer[] = searchCatalog([expansionText, ...tried].join(' '), { limit: 10 }).map((h) => ({ id: h.entry.id, source: h.entry.source, score: h.score }));
  return selectFix(original, expansion);
}

// --- fix: a unique high-confidence series from one source ---

{
  // "quema de rastrojo" (agricultural burning) matches nothing relevant today;
  // the MODIS fires layers (English metadata) are the obvious intent.
  const d = decide('quema de rastrojo', 'capa de focos de incendio activos, fire hotspot MODIS VIIRS');
  assert.equal(d.kind, 'fix', `quema de rastrojo should auto-fix, got ${d.kind}`);
  if (d.kind === 'fix') {
    assert.ok(d.layers.length > 0 && d.layers.length <= MAX_GROUP);
    assert.ok(d.layers.every((l) => l.id.startsWith('dgct:fires_modis')), `only MODIS fires layers: ${d.layers.map((l) => l.id)}`);
  }
}

// --- triage: several plausible layers across sources (no clear winner) ---

{
  const d = decide('trenes', 'vías férreas, ferrocarril, railway, estaciones de tren');
  assert.equal(d.kind, 'triage', `trenes should be triage (many legit layers), got ${d.kind}`);
}

// --- triage: expansion matches are below the score floor ---

{
  const d = decide('piscinas', 'piletas de natación, swimming pools');
  assert.equal(d.kind, 'triage', `piscinas should be triage (nothing confident), got ${d.kind}`);
}

// --- not-a-miss: the query already finds what was expected ---

{
  const d = decide('aeropuertos', 'aeropuertos, aeródromo, airport');
  assert.equal(d.kind, 'not-a-miss', `aeropuertos should be not-a-miss, got ${d.kind}`);
}

// --- the gate never fixes below the absolute floor, even with a single candidate ---

{
  const original: ScoredLayer[] = [];
  const expansion: ScoredLayer[] = [{ id: 'x:y', source: 'x', score: MIN_SCORE - 1 }];
  assert.equal(selectFix(original, expansion).kind, 'triage');
}

// --- alias terms: meaningful tokens only, deduped, capped ---

{
  const terms = aliasTerms('quiero un mapa de quema de rastrojo', ['quema', 'controlled burn']);
  assert.deepEqual(terms, ['quema', 'rastrojo', 'controlled', 'burn']);
  assert.ok(aliasTerms('a the of', []).length === 0, 'stopwords only -> no terms');
}

// --- report parsing: strict format, length caps, untrusted content stays data ---

{
  const body = [
    '## Search miss report',
    '',
    '**Query:** `focos de calor`',
    '',
    '**Expected:** a layer of active fire hotspots for Tucumán',
    '',
    '**Tried terms:** `incendio`, `fire`, `hotspot`',
    '',
    '**Client:** claude-desktop',
    '',
    '<!-- miss-report v1 fp:0123456789abcdef -->',
  ].join('\n');
  assert.deepEqual(parseReport(body), { query: 'focos de calor', expectation: 'a layer of active fire hotspots for Tucumán', triedTerms: ['incendio', 'fire', 'hotspot'] });
  assert.equal(parseReport('random free text'), null);
  assert.equal(parseReport('**Query:** `x`'), null, 'missing expectation must not parse');
}

console.log('AUTOFIX TESTS OK');
