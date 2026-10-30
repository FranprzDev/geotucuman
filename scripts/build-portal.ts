/** Genera docs/index.html (miniweb publica, buscador de datasets) y docs/capas.html (catalogo de capas). Sin dependencias externas. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Catalog, CatalogEntry } from '../src/catalog.js';

const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf-8')) as Catalog;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** El IGN a veces publica abstracts envueltos en CDATA; se limpian para mostrar texto plano. */
const cleanText = (s: string) => s.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();

const REPO = 'https://github.com/FranprzDev/geotucuman';
const CAPTURE_DATE = '2026-10-30';

const SOURCE_LABEL: Record<string, string> = {
  geosplan: 'Planeamiento (Geosplan) - Tucuman',
  dgct: 'Direccion General de Catastro - Tucuman',
  ign: 'Instituto Geografico Nacional - Argentina',
};

const SOURCE_ORG: Record<string, string> = {
  geosplan: 'Secretaría de Estado de Gestión Pública y Planeamiento, Tucumán',
  dgct: 'Dirección General de Catastro (DGCT), Tucumán',
  ign: 'Instituto Geográfico Nacional (IGN), Argentina',
};

const SOURCE_ENDPOINT: Record<string, string> = {
  geosplan: 'http://g.geosplan.tucuman.gob.ar/geoserver/WFS_GEOSPLAN/wfs',
  dgct: 'http://200.49.89.203/geoserver/dgct/wfs',
  ign: 'https://wms.ign.gob.ar/geoserver/ows',
};

/** Estado honesto por fuente: live = verde, preserved = ambar. */
function statusKind(id: string): 'live' | 'preserved' {
  const s = catalog.sources[id];
  return s && s.status === 'live' ? 'live' : 'preserved';
}

function statusText(id: string): string {
  const s = catalog.sources[id];
  if (!s) return '';
  return s.status === 'live'
    ? `actualizado ${s.fetchedAt.slice(0, 10)}`
    : `snapshot del ${s.fetchedAt.slice(0, 10)}`;
}

const counts: Record<string, number> = { geosplan: 0, dgct: 0, ign: 0 };
for (const l of catalog.layers) counts[l.source] = (counts[l.source] ?? 0) + 1;
const capasLine = `${counts.geosplan} Planeamiento · ${counts.dgct} Catastro · ${counts.ign} IGN = ${catalog.layers.length} capas`;

const geosplanDemo = JSON.parse(readFileSync('data/demo/geosplan-aeropuerto.json', 'utf-8'));
const dgctDemo = JSON.parse(readFileSync('data/demo/dgct-secciones.json', 'utf-8'));
const geosplanDemoHtml = esc(JSON.stringify(geosplanDemo, null, 2));
const dgctDemoHtml = esc(JSON.stringify(dgctDemo, null, 2));

/** Extrae años (19xx/20xx) y rangos (ej. 2008-2017) del texto, sin duplicar extremos de rango. */
function extractYears(text: string): string[] {
  const year = '(?:19\\d{2}|20\\d{2})';
  const rangeRe = new RegExp(`(?<!\\d)(${year})\\s*[-–]\\s*(${year})(?!\\d)`, 'g');
  const singleRe = new RegExp(`(?<!\\d)(${year})(?!\\d)`, 'g');
  const out: string[] = [];
  const rangeEnds = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(text)) !== null) {
    out.push(`${m[1]}-${m[2]}`);
    rangeEnds.add(m[1]);
    rangeEnds.add(m[2]);
  }
  while ((m = singleRe.exec(text)) !== null) {
    if (!rangeEnds.has(m[1])) out.push(m[1]);
  }
  return [...new Set(out)];
}

/** Linea honesta de vigencia del dato: solo afirma el año si aparece en el nombre/descripcion. */
function vintageLine(l: CatalogEntry): string {
  const years = extractYears(`${l.title} ${l.abstract} ${l.typeName}`);
  return years.length > 0
    ? `Dato: ${years.join(', ')} (según el nombre de la capa)`
    : 'Vigencia: sin indicar.';
}

/** URL de descarga WFS para una capa, sin limite de cantidad de features. */
function downloadUrl(l: CatalogEntry, outputFormat: string): string {
  return `${l.endpoint}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${l.typeName}&outputFormat=${outputFormat}&srsName=EPSG:4326`;
}

function crsShort(l: CatalogEntry): string {
  return l.defaultCrs.replace(/^urn:(x-)?ogc:def:crs:EPSG::?(\d+).*$/, 'EPSG:$2');
}

/** Card HTML del catalogo: mismo diseno que los resultados del buscador de la portada. */
function cardHtml(l: CatalogEntry): string {
  const label = SOURCE_LABEL[l.source] ?? l.source;
  const abs = cleanText(l.abstract)
    ? `<p class="card-abs">${esc(cleanText(l.abstract))}</p>`
    : '<p class="card-abs dim">Sin descripción publicada.</p>';
  const geojson = esc(downloadUrl(l, 'application%2Fjson'));
  const shapefile = esc(downloadUrl(l, 'shape-zip'));
  return `<article class="card" data-src="${l.source}" data-t="${esc(`${l.title} ${l.typeName}`.toLowerCase())}" data-d="${esc((l.abstract || '').toLowerCase())}" data-k="${esc(l.keywords.join(' ').toLowerCase())}">
    <h3 class="card-title">${esc(l.title)}</h3>
    ${abs}
    <div class="card-meta"><span class="src src-${l.source}">${esc(label)}</span><span class="vig">${esc(vintageLine(l))}</span></div>
    <p class="meta-line">Publica: ${esc(SOURCE_ORG[l.source] ?? label)}</p>
    <p class="meta-line">Catálogo verificado: ${esc(l.verifiedAt)}</p>
    <p class="downloads">Descargar: <a class="dbtn" href="${geojson}" target="_blank" rel="noopener">GeoJSON</a> <a class="dbtn alt" href="${shapefile}" target="_blank" rel="noopener">Shapefile (.zip)</a></p>
    <details class="tech"><summary>Detalles técnicos</summary><div class="tech-body"><code class="typename">${esc(l.typeName)}</code><div class="card-foot"><span class="crs">${esc(crsShort(l))}</span><span class="endpoint">${esc(l.endpoint)}</span></div></div></details>
  </article>`;
}

const cards = catalog.layers.map(cardHtml).join('\n');

/** Indice JSON compacto de TODAS las capas, embebido en la portada para el buscador inline. */
const indexData = catalog.layers.map((l) => {
  const years = extractYears(`${l.title} ${l.abstract} ${l.typeName}`);
  return {
    title: l.title,
    typeName: l.typeName,
    source: l.source,
    vintage: years.length > 0 ? years.join(', ') : null,
    abstract: cleanText(l.abstract),
    endpoint: l.endpoint,
    keywords: l.keywords,
    verifiedAt: l.verifiedAt,
    crs: crsShort(l),
  };
});
const indexJson = JSON.stringify(indexData).replace(/</g, '\\u003c');

const SEARCH_CORE = `const TOPICS = {
  agua: ['agua', 'hidro', 'rio', 'acequia', 'zanja', 'acueducto', 'canal', 'dique', 'embalse', 'espejo', 'corriente', 'cuenca', 'catarata'],
  transporte: ['calle', 'camino', 'vial', 'ferro', 'aero', 'transporte', 'puente'],
  poblacion: ['radio', 'censo', 'localidad', 'departamento', 'comuna'],
  rural: ['cultivo', 'agro', 'suelo', 'edafo', 'parcela', 'rural', 'soja', 'maiz', 'trigo', 'papa', 'garbanzo', 'citrus', 'tabaco', 'canera', 'ingenio'],
  ambiente: ['vegetacion', 'bosque', 'protegida', 'geomorfo', 'glacio'],
  servicios: ['salud', 'educacion', 'comunicacion', 'energia', 'equipamiento'],
};
const TOPIC_OF = {};
for (const topic of Object.keys(TOPICS)) {
  for (const word of [topic, ...TOPICS[topic]]) {
    TOPIC_OF[word] = (TOPIC_OF[word] || []).concat(TOPICS[topic]);
  }
}
const STOPWORDS = new Set(['quiero', 'quisiera', 'hacer', 'armar', 'necesito', 'saber', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'cual', 'cuales', 'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'de', 'del', 'en', 'y', 'o', 'a', 'por', 'para', 'con', 'sobre', 'que', 'me', 'te', 'se', 'lo', 'es', 'hay', 'mapa', 'mapas', 'capa', 'capas', 'dato', 'datos', 'dataset', 'datasets', 'tucuman']);
const norm = s => s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
function variantsFor(term) {
  const bases = [term];
  if (term.endsWith('es') && term.length - 2 >= 3) bases.push(term.slice(0, -2));
  if (term.endsWith('s') && term.length - 1 >= 3) bases.push(term.slice(0, -1));
  const out = [];
  for (const b of bases) {
    out.push(b);
    if (TOPIC_OF[b]) out.push(...TOPIC_OF[b]);
  }
  return out;
}
function tierScore(card, term) {
  const tiers = [norm(card.dataset.t), norm(card.dataset.d), norm(card.dataset.k)];
  const bases = [term];
  if (term.endsWith('es') && term.length - 2 >= 3) bases.push(term.slice(0, -2));
  if (term.endsWith('s') && term.length - 1 >= 3) bases.push(term.slice(0, -1));
  for (let i = 0; i < tiers.length; i++) {
    if (bases.some(b => tiers[i].includes(b))) return i;
  }
  const generic = variantsFor(term);
  for (let i = 0; i < tiers.length; i++) {
    if (generic.some(v => tiers[i].includes(v))) return 2;
  }
  return -1;
}
`;

const LICENSE_BODY = `
  <p>Que un servicio sea público no garantiza reutilización. Lo siguiente son los términos publicados por cada organismo a nivel sitio/servicio, no licencias por capa; revisá el enlace antes de redistribuir:</p>
  <ul>
    <li><span class="src src-geosplan">${esc(SOURCE_LABEL.geosplan)}</span> Términos publicados del sitio: <a href="http://geosplan.tucuman.gov.ar/index.php/institucional/terminos-de-uso/">"La Secretaría de Estado de Gestión Pública y Planeamiento promueve el acceso y reutilización de la información publicada en este sitio web. Comparte la información en los términos que establece las licencias Creative Commons: Reconocimiento-No comercial-Compartir Igual"</a>, con criterios: "Que el contenido de la información no sea alterado", "Que no se desnaturalice el sentido de la información", "Que se cite la fuente", "Que se mencione la fecha de la última actualización", "Que no se persigan fines comerciales con la obra original o la utilización de la información publicada".</li>
    <li><span class="src src-ign">${esc(SOURCE_LABEL.ign)}</span> Términos publicados del organismo para "información descargada del sitio web del IGN": <a href="https://www.ign.gob.ar/descargas/tyc1.html">"Debe reconocerse la autoría del Instituto Geográfico Nacional de la República Argentina. Se debe compartir de manera libre y gratuita. Se permite su uso comercial únicamente en el caso de obras derivadas en que la información sea utilizada como insumo para generar un nuevo producto. El IGN no se responsabiliza por las consecuencias de la utilización de la información descargada."</a></li>
    <li><span class="src src-dgct">${esc(SOURCE_LABEL.dgct)}</span> Términos publicados del organismo: <a href="https://catastrotucuman.gov.ar/gestiones/servicio-wms-wfs/">no se publica licencia ni términos de uso; el servicio está documentado como experimental desde 2012</a>.</li>
  </ul>
  <p>Geocodificación: términos publicados del <a href="https://www.argentina.gob.ar/georef/condiciones-de-uso-y-licencia">Servicio Georef</a>: "Atribución obligatoria: se debe mencionar la fuente como 'Servicio Georef – argentina.gob.ar/georef' o incluir un enlace al sitio oficial. Indicación de modificaciones: si se redistribuye la información con cambios, debe indicarse que ha sido modificada. Uso responsable."</p>
  <p>El GetCapabilities de cada servicio no publica licencia por capa: la licencia de cada capa concreta queda sin verificar.</p>`;

/** Sistema visual comun a ambas paginas. */
const BASE_CSS = `
  * { box-sizing: border-box; }
  :root { --bg: #f4f7f9; --ink: #1c2530; --muted: #5a6a76; --line: #dbe4ea; --brand: #0d6e8c; --brand-dark: #0d3b4f; --radius: 16px; --shadow: 0 1px 3px rgba(13,59,79,.08); }
  html { -webkit-text-size-adjust: 100%; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; background: var(--bg); color: var(--ink); line-height: 1.55; }
  a { color: var(--brand); }
  a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 6px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; background: #eef3f6; padding: 1px 5px; border-radius: 6px; word-break: break-word; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 16px; width: 100%; }
  .panel { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px 22px; margin: 16px 0; }
  .panel > h2 { font-size: 20px; font-weight: 600; color: var(--brand-dark); margin: 0 0 14px; }
  .panel p, .panel li { font-size: 14px; color: #40505c; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px 18px; }
  h3.card-title { font-size: 17px; margin: 0 0 6px; color: var(--brand-dark); }
  code.typename { font-size: 12px; word-break: break-all; display: inline-block; }
  .card-abs { font-size: 13.5px; color: #40505c; margin: 8px 0; }
  .card-abs.dim { color: #94a3ad; font-style: italic; }
  .card-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0 4px; }
  .vig { font-size: 12px; color: var(--muted); }
  .meta-line { font-size: 12px; color: var(--muted); margin: 4px 0 0; }
  .downloads { font-size: 12.5px; color: var(--muted); margin: 10px 0 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .dbtn { display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; border-radius: 999px; background: var(--brand); color: #fff; text-decoration: none; font-size: 13px; font-weight: 600; border: 1.5px solid var(--brand); }
  .dbtn.alt { background: #fff; color: var(--brand); }
  .card-foot { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 8px; }
  .crs { font-size: 11.5px; color: #7c8a96; }
  .endpoint { font-size: 11px; color: #94a3ad; word-break: break-all; }
  .src { font-size: 11.5px; font-weight: 600; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
  .src-geosplan { background: #e3f2e9; color: #1c6b41; }
  .src-dgct { background: #fdeeda; color: #93550f; }
  .src-ign { background: #e2ecfb; color: #1d4e9e; }
  .src-georef { background: #eae6f8; color: #4a3a91; }
  .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; background: var(--brand); color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 999px; font-size: 14px; font-weight: 600; border: 1.5px solid var(--brand); cursor: pointer; }
  .btn.ghost { background: transparent; color: #fff; border-color: rgba(255,255,255,.65); }
  .btn.ghost-light { background: #fff; color: var(--brand); border-color: var(--line); }
  .dim { color: #94a3ad; }
  .hint { font-size: 12.5px; color: var(--muted); margin-top: 8px; }
  .scope { font-size: 13px; color: #40505c; margin-top: 10px; line-height: 1.55; }
  details.licenses { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 4px 20px; margin: 16px 0; }
  details.licenses > summary { cursor: pointer; font-size: 20px; font-weight: 600; color: var(--brand-dark); padding: 14px 0; list-style: none; }
  details.licenses > summary::-webkit-details-marker { display: none; }
  details.licenses > summary::before { content: "▸ "; color: var(--brand); }
  details.licenses[open] > summary::before { content: "▾ "; }
  details.licenses p, details.licenses li { font-size: 13px; color: #40505c; line-height: 1.5; }
  details.licenses ul { margin: 8px 0; padding-left: 18px; }
  details.licenses li { margin: 6px 0; }
  details.licenses a { color: var(--brand); }
  footer.site { font-size: 12.5px; color: var(--muted); margin: 24px 0 48px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  details.tech { margin-top: 10px; }
  details.tech > summary { cursor: pointer; font-size: 12.5px; color: var(--muted); font-weight: 600; list-style: none; }
  details.tech > summary::-webkit-details-marker { display: none; }
  details.tech > summary::before { content: "> "; color: var(--brand); }
  details.tech[open] > summary::before { content: "v "; }
  details.tech .tech-body { margin-top: 8px; }`;

/** Estilos de la portada (buscador como producto). */
const LANDING_CSS = `
  .hero { background: linear-gradient(135deg, #0d3b4f 0%, #0d6e8c 100%); color: #fff; padding: 52px 16px 46px; position: relative; overflow: hidden; }
  .hero-grid { display: grid; grid-template-columns: 1fr; gap: 26px; align-items: center; }
  @media (min-width: 900px) { .hero-grid { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 40px; } }
  .kicker { font-size: 12px; letter-spacing: .16em; text-transform: uppercase; opacity: .82; margin: 0 0 12px; font-weight: 600; }
  .hero h1 { font-size: clamp(32px, 7vw, 46px); margin: 0 0 12px; letter-spacing: -.01em; line-height: 1.08; }
  .hero .promise { font-size: clamp(15px, 2.4vw, 17.5px); max-width: 640px; margin: 0 0 26px; opacity: .94; }
  .hero-map { display: block; width: 100%; max-width: 330px; margin: 0 auto; }
  @media (max-width: 899px) { .hero-map { max-width: 210px; } }
  .searchbox { max-width: 760px; }
  .example { margin: 12px 0 0; font-size: 13.5px; opacity: .92; }
  .example button { background: none; border: 0; color: #fff; text-decoration: underline; text-underline-offset: 3px; font-size: 13.5px; cursor: pointer; padding: 8px 0; min-height: 44px; }
  .search { width: 100%; min-height: 60px; font-size: 19px; padding: 16px 22px; border-radius: 999px; border: 0; box-shadow: 0 8px 24px rgba(13,59,79,.30); color: var(--ink); }
  .search::placeholder { color: #8b98a3; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; padding: 0; list-style: none; }
  .chip { min-height: 44px; display: inline-flex; align-items: center; padding: 8px 16px; border-radius: 999px; border: 1.5px solid rgba(255,255,255,.5); background: rgba(255,255,255,.12); color: #fff; font-size: 14px; cursor: pointer; }
  .chip:hover { background: rgba(255,255,255,.22); }
  .results { margin: 22px 0 8px; }
  .results-head { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; align-items: baseline; margin: 0 0 8px; }
  .results-count { font-size: 16px; font-weight: 600; color: var(--brand-dark); margin: 0; }
  .see-all { font-size: 14px; font-weight: 600; text-decoration: none; }
  .rank-hint { font-size: 12.5px; color: var(--muted); margin: 0 0 14px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
  @media (min-width: 760px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  .steps { list-style: none; padding: 0; margin: 0; counter-reset: s; }
  .steps li { display: flex; gap: 12px; align-items: flex-start; margin: 14px 0; font-size: 14.5px; color: #31424e; }
  .steps li::before { counter-increment: s; content: counter(s); flex: 0 0 30px; height: 30px; width: 30px; border-radius: 50%; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
  .step-title { font-weight: 600; color: var(--brand-dark); }
  .tag { display: inline-block; background: #eef3f6; border: 1px solid var(--line); color: #31424e; border-radius: 999px; padding: 6px 13px; font-size: 13px; margin: 0 6px 8px 0; }
  .source-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin: 10px 0; background: #fff; }
  .source-card .org { margin: 6px 0 4px; font-size: 14px; color: #31424e; }
  .status { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--muted); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 9px; }
  .dot.live { background: #1c9c5b; }
  .dot.preserved { background: #d9930f; }
  .demo { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin: 12px 0; background: #fbfdfe; }
  .demo h3 { margin: 0 0 10px; font-size: 15px; color: var(--brand-dark); }
  .demo .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .demo input[type=text], .demo select { font-size: 14px; padding: 9px 11px; border: 1.5px solid #b9c8d2; border-radius: 10px; background: #fff; min-height: 44px; }
  .demo input[type=text] { flex: 1 1 240px; }
  .demo pre { background: #0d3b4f; color: #e8f1f5; padding: 12px 14px; border-radius: 10px; overflow: auto; font-size: 12px; line-height: 1.45; max-height: 360px; }
  .demo .dim { color: #94a3ad; font-style: italic; }
  .demo .err { color: #a01b1b; background: #fdecec; border: 1px solid #f3c4c4; border-radius: 8px; padding: 8px 10px; }
  .demo .attr { font-size: 12px; color: #7c8a96; margin: 8px 0 0; }
  .demo .out { margin-top: 12px; }
  .demo .out ul { margin: 6px 0; padding-left: 18px; font-size: 13px; }
  .demo.note { background: #fdf6e8; border-color: #f0dfb8; }
  .demo.note p { margin: 6px 0; }
  @media (max-width: 520px) { .hero { padding: 34px 16px 30px; } .search { font-size: 17px; min-height: 56px; } }`;

/** Estilos del catalogo. */
const CATALOG_CSS = `
  .hero-slim { background: linear-gradient(135deg, #0d3b4f 0%, #0d6e8c 100%); color: #fff; padding: 24px 16px 22px; }
  .hero-slim h1 { font-size: 24px; margin: 0 0 4px; }
  .hero-slim p { margin: 0; font-size: 13.5px; opacity: .92; }
  .hero-slim a { color: #fff; text-decoration: underline; font-size: 13px; }
  .controls { position: sticky; top: 0; background: var(--bg); padding: 14px 0 12px; z-index: 20; border-bottom: 1px solid var(--line); }
  #q { width: 100%; min-height: 48px; font-size: 16px; padding: 12px 16px; border: 1.5px solid #b9c8d2; border-radius: 999px; background: #fff; }
  .filters { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .filters button { min-height: 44px; font-size: 13.5px; padding: 0 16px; border-radius: 999px; border: 1.5px solid var(--brand); background: #fff; color: var(--brand); cursor: pointer; font-weight: 600; }
  .filters button.on { background: var(--brand); color: #fff; }
  #count { font-size: 14px; font-weight: 600; color: var(--brand-dark); margin-top: 10px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 8px; }
  @media (min-width: 760px) { .grid { grid-template-columns: repeat(2, 1fr); } }`;

const licensesDetails = `<details class="licenses">
  <summary>Licencias y atribución por fuente</summary>${LICENSE_BODY}
</details>`;

const catalogHtml = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoTucumán — Catálogo de capas geográficas públicas</title>
<style>${BASE_CSS}${CATALOG_CSS}
</style>
</head>
<body>
<header class="hero-slim">
  <div class="wrap">
    <h1>GeoTucumán</h1>
    <p>Catálogo de capas geográficas públicas: Tucumán primero. ${esc(capasLine)}. <a href="./index.html">← Volver al buscador</a></p>
  </div>
</header>
<div class="wrap">
  <div class="controls">
    <input id="q" type="search" placeholder='Buscar por tema o palabra: "agua", "cultivos", "calles"...' aria-label="Buscar en el catálogo">
    <div class="filters">
      <button data-f="" class="on">Todas</button>
      <button data-f="geosplan">Planeamiento</button>
      <button data-f="dgct">Catastro</button>
      <button data-f="ign">IGN</button>
    </div>
    <div id="count"></div>
  </div>
  <p class="hint">Probá por intención: "quiero hacer un mapa sobre agua" también funciona (sin las comillas).</p>
  <p class="hint">La descarga trae la capa completa; algunas capas son grandes. Geosplan y Catastro (DGCT) sirven por HTTP plano, así que el navegador bloquea consultas en vivo desde esta página HTTPS (contenido mixto); acá se ofrecen como descarga directa.</p>
  <p class="hint">Orden: primero coincidencias en el nombre de la capa, después en la descripción, al final en palabras clave genéricas.</p>
  <p class="scope">GeoTucumán descubre y sugiere datasets: cuáles existen, quién los publica, de cuándo son y cómo descargarlos. No arma mapas ni análisis: eso lo hacés vos con el dataset. Ojo: una capa muestra lo que contiene — las parcelas catastrales no dicen cuántas personas viven ahí; para población buscá capas censales.</p>
  <div class="grid" id="grid">${cards}
  </div>
  ${licensesDetails}
  <p class="dim">Catálogo generado el ${esc(catalog.generatedAt.slice(0, 10))}. ${catalog.layers.length} capas.</p>
</div>
<script>
${SEARCH_CORE}
const q = document.getElementById('q');
const initialQ = new URLSearchParams(location.search).get('q');
if (initialQ) q.value = initialQ;
const cards = [...document.querySelectorAll('.card')];
const grid = document.getElementById('grid');
const countEl = document.getElementById('count');
let filter = '';
function apply() {
  const raw = norm(q.value).split(/\\s+/).filter(Boolean);
  const terms = raw.filter(t => !STOPWORDS.has(t));
  const shown = [];
  for (const c of cards) {
    let okQ = !filter || c.dataset.src === filter;
    let score = 0;
    if (okQ) {
      for (const t of terms) {
        const tier = tierScore(c, t);
        if (tier < 0) { okQ = false; break; }
        score += tier;
      }
    }
    if (okQ) shown.push({ c, score });
  }
  shown.sort((a, b) => a.score - b.score);
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  for (const s of shown) { s.c.style.display = ''; grid.appendChild(s.c); }
  countEl.textContent = shown.length === 0
    ? '0 capas para esta búsqueda. El catálogo cubre 3 servicios WFS + Georef; la capa que buscás puede no estar publicada en estas fuentes (ver la portada, sección Fuentes).'
    : shown.length + ' capas';
}
q.addEventListener('input', apply);
document.querySelectorAll('.filters button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.filters button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); filter = b.dataset.f; apply();
}));
apply();
</script>
</body>
</html>`;

const landingHtml = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoTucumán — Buscador de datasets públicos de Tucumán</title>
<meta name="description" content="Encontrá datasets públicos de Tucumán para tu mapa, tu tesis o tu trabajo.">
<style>${BASE_CSS}${LANDING_CSS}
</style>
</head>
<body>
<header class="hero">
  <div class="wrap hero-grid">
   <div>
    <p class="kicker">Datasets públicos · Tucumán, Argentina</p>
    <h1>GeoTucumán</h1>
    <p class="promise">Encontrá datasets públicos de Tucumán para tu mapa, tu tesis o tu trabajo. Te decimos quién los publica, de cuándo son y cómo descargarlos.</p>
    <div class="searchbox">
      <input id="q" class="search" type="search" autocomplete="off" spellcheck="false" placeholder='Ej: "quiero hacer un mapa sobre agua"' aria-label="Buscar datasets">
      <p class="example">Probá con un ejemplo: <button type="button" data-example="quiero hacer un mapa de cultivos de soja">quiero hacer un mapa de cultivos de soja</button></p>
    </div>
    <ul class="chips" id="chips">
      <li><button type="button" class="chip" data-topic="agua">agua</button></li>
      <li><button type="button" class="chip" data-topic="cultivos">cultivos</button></li>
      <li><button type="button" class="chip" data-topic="calles">calles</button></li>
      <li><button type="button" class="chip" data-topic="censo">censo</button></li>
      <li><button type="button" class="chip" data-topic="ambiente">ambiente</button></li>
      <li><button type="button" class="chip" data-topic="transporte">transporte</button></li>
      <li><button type="button" class="chip" data-topic="parcelas">parcelas</button></li>
    </ul>
   </div>
   <div>
    <svg class="hero-map" viewBox="0 0 220 260" aria-hidden="true" focusable="false">
      <g fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.4">
        <ellipse cx="62" cy="206" rx="56" ry="36"/>
        <ellipse cx="62" cy="206" rx="38" ry="24"/>
        <ellipse cx="62" cy="206" rx="21" ry="13"/>
        <ellipse cx="186" cy="42" rx="46" ry="30"/>
        <ellipse cx="186" cy="42" rx="29" ry="18"/>
      </g>
      <path d="M72 12 L118 8 L150 22 L158 58 L138 96 L132 140 L116 200 L104 244 L88 226 L74 178 L58 130 L52 78 L60 36 Z" fill="rgba(255,255,255,.10)" stroke="#fff" stroke-width="2.2" stroke-dasharray="0.5 7" stroke-linecap="round"/>
      <circle cx="112" cy="140" r="4.5" fill="#ffd166"/>
      <circle cx="112" cy="140" r="9" fill="none" stroke="#ffd166" stroke-width="1.4" opacity=".7"/>
      <text x="124" y="144" fill="#fff" font-size="10.5" font-family="system-ui, sans-serif" opacity=".92">S. M. de Tucumán</text>
      <text x="110" y="254" fill="rgba(255,255,255,.6)" font-size="9" font-family="system-ui, sans-serif" text-anchor="middle">ilustración, no un dato</text>
    </svg>
    <span class="sr-only">Mapa esquemático decorativo de la provincia de Tucumán; es una ilustración, no un resultado de datos.</span>
   </div>
  </div>
</header>
<div class="wrap">
  <section class="results" aria-live="polite">
    <div class="results-head">
      <p class="results-count" id="count">Escribí qué necesitás en palabras comunes.</p>
      <a class="see-all" id="see-all" href="./capas.html">Ver todos en el catálogo →</a>
    </div>
    <p class="rank-hint">Orden: primero coincidencias en el nombre de la capa, después en la descripción, al final en palabras clave genéricas.</p>
    <div class="grid" id="grid"></div>
  </section>

  <section class="panel">
    <h2>Cómo funciona</h2>
    <ol class="steps">
      <li><span><span class="step-title">Contanos qué necesitás</span> en palabras comunes.</span></li>
      <li><span><span class="step-title">Te mostramos qué datasets existen</span>, quién los publica y de cuándo son.</span></li>
      <li><span><span class="step-title">Descargás el dataset</span> y armás tu mapa o análisis vos.</span></li>
    </ol>
  </section>

  <section class="panel">
    <h2>Probá las consultas en vivo</h2>
    <div class="demo">
      <h3>Geocodificar (API Georef, en vivo)</h3>
      <div class="row">
        <input id="geo-input" type="text" value="25 de Mayo y Marcos Paz">
        <button class="btn" id="geo-btn" type="button">Geocodificar</button>
      </div>
      <div id="geo-out" class="out"><p class="dim">Escribí una dirección y tocá Geocodificar.</p></div>
    </div>
    <div class="demo">
      <h3>Consultar una capa (WFS del IGN, en vivo)</h3>
      <div class="row">
        <select id="wfs-select">
          <option value="ign:area_protegida">Área protegida</option>
          <option value="ign:puntos_de_transporte_aereo_GB001">Aeródromo</option>
          <option value="ign:lineas_de_aguas_continentales_perenne">Corriente de agua perenne</option>
        </select>
        <button class="btn" id="wfs-btn" type="button">Consultar en vivo</button>
      </div>
      <div id="wfs-out" class="out"><p class="dim">Elegí una capa y tocá Consultar en vivo.</p></div>
    </div>
    <div class="demo note">
      <h3>Geosplan y Catastro (DGCT): capturas reales</h3>
      <p>Geosplan y Catastro (DGCT) sirven por HTTP plano, así que el navegador bloquea consultas en vivo desde esta página HTTPS (contenido mixto). En su lugar se muestran respuestas reales registradas el ${CAPTURE_DATE}:</p>
      <p><strong>${esc(SOURCE_ORG.geosplan)}</strong><br><code>${esc(SOURCE_ENDPOINT.geosplan)}</code><br>capa <code>WFS_GEOSPLAN:aeropuerto</code> · capturado ${CAPTURE_DATE}</p>
      <pre>${geosplanDemoHtml}</pre>
      <p><strong>${esc(SOURCE_ORG.dgct)}</strong><br><code>${esc(SOURCE_ENDPOINT.dgct)}</code><br>capa <code>dgct:SECCIONES</code> · capturado ${CAPTURE_DATE}</p>
      <pre>${dgctDemoHtml}</pre>
    </div>
  </section>

  <section class="panel">
    <h2>Qué hay atrás</h2>
    <p>
      <span class="tag">MCP</span><span class="tag">TypeScript</span><span class="tag">WFS</span><span class="tag">API Georef</span><span class="tag">Reproyección Gauss-Krüger propia</span><span class="tag">Catálogo con snapshot</span>
    </p>
    <p>Un servidor MCP por stdio en TypeScript estricto consulta servicios WFS oficiales y la API Georef. El catálogo se genera desde los <code>GetCapabilities</code> en vivo y preserva un snapshot si un endpoint cae; el bbox se consulta en EPSG:4326 y se reproyecta al CRS nativo de cada capa con una reproyección Gauss-Krüger/TM propia. GeoTucumán descubre y cita la fuente: no arma el mapa ni el análisis por vos.</p>
  </section>

  <section class="panel">
    <h2>Fuentes</h2>
    <div class="source-card">
      <div class="status"><span class="dot ${statusKind('geosplan')}"></span><span>${esc(statusText('geosplan'))}</span></div>
      <p class="org"><span class="src src-geosplan">Geosplan</span> ${esc(SOURCE_ORG.geosplan)}</p>
      <code>${esc(SOURCE_ENDPOINT.geosplan)}</code>
    </div>
    <div class="source-card">
      <div class="status"><span class="dot ${statusKind('dgct')}"></span><span>${esc(statusText('dgct'))}</span></div>
      <p class="org"><span class="src src-dgct">Catastro (DGCT)</span> ${esc(SOURCE_ORG.dgct)}</p>
      <code>${esc(SOURCE_ENDPOINT.dgct)}</code>
      <p class="hint">Documentado como experimental desde 2012; el endpoint es intermitente (cayó y volvió el ${CAPTURE_DATE}).</p>
    </div>
    <div class="source-card">
      <div class="status"><span class="dot ${statusKind('ign')}"></span><span>${esc(statusText('ign'))}</span></div>
      <p class="org"><span class="src src-ign">IGN</span> ${esc(SOURCE_ORG.ign)}</p>
      <code>${esc(SOURCE_ENDPOINT.ign)}</code>
    </div>
    <div class="source-card">
      <div class="status"><span class="dot live"></span><span>geocodificación en vivo</span></div>
      <p class="org"><span class="src src-georef">Georef</span> Geocodificación (API Georef)</p>
      <code>https://apis.datos.gob.ar/georef/api/</code>
    </div>
    <p class="scope">Cobertura: hoy 3 servicios WFS + la API Georef. No es exhaustivo: hay más datasets públicos dispersos. Faltantes conocidos: RIDES (Producción, Tucumán: <a href="https://rides.producciontucuman.gob.ar/">https://rides.producciontucuman.gob.ar/</a>), el portal de Datos Abiertos de Tucumán (<a href="https://datos.tucuman.gob.ar/">https://datos.tucuman.gob.ar/</a>) y el enriquecimiento con metadatos IDERA.</p>
    <p class="scope dim">Una capa muestra lo que contiene: las parcelas catastrales no dicen cuántas personas viven ahí; para población buscá capas censales. El GetCapabilities de cada servicio no publica licencia por capa: la licencia de cada capa concreta queda sin verificar.</p>
  </section>

  ${licensesDetails}

  <footer class="site">
    Código MIT. Los datos son de sus organismos publicadores. Generado el ${esc(catalog.generatedAt.slice(0, 10))}. <a href="${REPO}">Repositorio en GitHub</a>.
  </footer>
</div>
<script type="application/json" id="index-data">${indexJson}</script>
<script>
${SEARCH_CORE}
(function () {
  const SOURCE_LABEL = ${JSON.stringify(SOURCE_LABEL)};
  const SOURCE_ORG = ${JSON.stringify(SOURCE_ORG)};
  const LIMIT = 12;
  const escHtml = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  const data = JSON.parse(document.getElementById('index-data').textContent);
  const q = document.getElementById('q');
  const grid = document.getElementById('grid');
  const countEl = document.getElementById('count');
  const seeAll = document.getElementById('see-all');
  function wfs(l, fmt) {
    return l.endpoint + '?service=WFS&version=2.0.0&request=GetFeature&typeNames=' + l.typeName + '&outputFormat=' + fmt + '&srsName=EPSG:4326';
  }
  function cardHtml(l) {
    const label = SOURCE_LABEL[l.source] || l.source;
    const org = SOURCE_ORG[l.source] || label;
    const vig = l.vintage ? 'Dato: ' + l.vintage : 'Vigencia: sin indicar';
    const abs = l.abstract
      ? '<p class="card-abs">' + escHtml(l.abstract) + '</p>'
      : '<p class="card-abs dim">Sin descripción publicada.</p>';
    const geojson = wfs(l, 'application%2Fjson');
    const shapefile = wfs(l, 'shape-zip');
    return '<h3 class="card-title">' + escHtml(l.title) + '</h3>' + abs +
      '<div class="card-meta"><span class="src src-' + l.source + '">' + escHtml(label) + '</span><span class="vig">' + escHtml(vig) + '</span></div>' +
      '<p class="meta-line">Publica: ' + escHtml(org) + '</p>' +
      '<p class="meta-line">Catálogo verificado: ' + escHtml(l.verifiedAt) + '</p>' +
      '<p class="downloads">Descargar: <a class="dbtn" href="' + escHtml(geojson) + '" target="_blank" rel="noopener">GeoJSON</a> <a class="dbtn alt" href="' + escHtml(shapefile) + '" target="_blank" rel="noopener">Shapefile (.zip)</a></p>' +
      '<details class="tech"><summary>Detalles técnicos</summary><div class="tech-body"><code class="typename">' + escHtml(l.typeName) + '</code><div class="card-foot"><span class="crs">' + escHtml(l.crs) + '</span><span class="endpoint">' + escHtml(l.endpoint) + '</span></div></div></details>';
  }
  const cardEls = data.map(function (l) {
    const el = document.createElement('article');
    el.className = 'card';
    el.dataset.src = l.source;
    el.dataset.t = (l.title + ' ' + l.typeName).toLowerCase();
    el.dataset.d = (l.abstract || '').toLowerCase();
    el.dataset.k = (l.keywords || []).join(' ').toLowerCase();
    el.innerHTML = cardHtml(l);
    return el;
  });
  function setSeeAll() {
    const v = q.value.trim();
    seeAll.href = './capas.html' + (v ? '?q=' + encodeURIComponent(v) : '');
  }
  function apply() {
    const v = q.value.trim();
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    if (!v) {
      countEl.textContent = 'Escribí qué necesitás en palabras comunes.';
      setSeeAll();
      return;
    }
    const raw = norm(v).split(/\\s+/).filter(Boolean);
    const terms = raw.filter(function (t) { return !STOPWORDS.has(t); });
    const list = [];
    for (const c of cardEls) {
      let ok = true, score = 0;
      for (const t of terms) {
        const tier = tierScore(c, t);
        if (tier < 0) { ok = false; break; }
        score += tier;
      }
      if (ok) list.push({ c: c, score: score });
    }
    list.sort(function (a, b) { return a.score - b.score; });
    const total = list.length;
    for (let i = 0; i < Math.min(LIMIT, total); i++) { list[i].c.style.display = ''; grid.appendChild(list[i].c); }
    countEl.textContent = total === 0
      ? '0 datasets para esta búsqueda. El catálogo cubre 3 servicios WFS + Georef; el dataset que buscás puede no estar publicado en estas fuentes (ver Fuentes).'
      : total + ' datasets';
    setSeeAll();
  }
  const initialQ = new URLSearchParams(location.search).get('q');
  if (initialQ) q.value = initialQ;
  q.addEventListener('input', apply);
  document.querySelectorAll('.chip').forEach(function (b) {
    b.addEventListener('click', function () { q.value = b.dataset.topic; apply(); q.focus(); });
  });
  document.querySelectorAll('[data-example]').forEach(function (b) {
    b.addEventListener('click', function () { q.value = b.dataset.example; apply(); q.focus(); });
  });
  apply();
})();
(function () {
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  function byId(id) { return document.getElementById(id); }
  var geoBtn = byId('geo-btn');
  if (geoBtn) {
    geoBtn.addEventListener('click', function () {
      var out = byId('geo-out');
      var input = byId('geo-input').value;
      out.innerHTML = '<p class="dim">Consultando Georef...</p>';
      var url = 'https://apis.datos.gob.ar/georef/api/direcciones?direccion=' + encodeURIComponent(input) + '&provincia=Tucum%C3%A1n&max=3';
      fetch(url).then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        return r.json();
      }).then(function (data) {
        var dirs = (data && data.direcciones) || [];
        var html = '<p><strong>' + dirs.length + '</strong> resultados.</p>';
        if (dirs.length) {
          html += '<ul>';
          for (var i = 0; i < dirs.length; i++) {
            var d = dirs[i];
            var u = d.ubicacion || {};
            html += '<li><code>' + esc(d.nomenclatura || '') + '</code> - lat ' + esc(u.lat) + ', lon ' + esc(u.lon) + '</li>';
          }
          html += '</ul>';
        }
        html += '<pre>' + esc(JSON.stringify(data, null, 2)) + '</pre>';
        html += '<p class="attr">Fuente: Servicio Georef – argentina.gob.ar/georef</p>';
        out.innerHTML = html;
      }).catch(function (e) {
        out.innerHTML = '<p class="err">Error al consultar Georef: ' + esc(e.message) + '</p>';
      });
    });
  }
  var wfsBtn = byId('wfs-btn');
  if (wfsBtn) {
    wfsBtn.addEventListener('click', function () {
      var out = byId('wfs-out');
      var tn = byId('wfs-select').value;
      out.innerHTML = '<p class="dim">Consultando WFS del IGN...</p>';
      var url = 'https://wms.ign.gob.ar/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=' + encodeURIComponent(tn) + '&count=3&outputFormat=application%2Fjson&srsName=EPSG:4326&bbox=-65.6,-27.2,-64.9,-26.5,EPSG:4326';
      fetch(url).then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        return r.json();
      }).then(function (data) {
        var feats = (data && data.features) || [];
        var full = JSON.stringify(data, null, 2);
        var trunc = full.length > 2500;
        var shown = trunc ? full.slice(0, 2500) : full;
        var html = '<p><strong>' + feats.length + '</strong> features devueltos.</p>';
        html += '<pre>' + esc(shown) + (trunc ? '\\n... (truncado)' : '') + '</pre>';
        out.innerHTML = html;
      }).catch(function (e) {
        out.innerHTML = '<p class="err">Error al consultar el WFS: ' + esc(e.message) + '</p>';
      });
    });
  }
})();
</script>
</body>
</html>`;

mkdirSync('docs', { recursive: true });
writeFileSync('docs/index.html', landingHtml);
writeFileSync('docs/capas.html', catalogHtml);
console.log(`docs/index.html generado (buscador de datasets) y docs/capas.html generado (${catalog.layers.length} capas)`);
