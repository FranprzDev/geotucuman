/** Genera docs/index.html (landing del MCP) y docs/capas.html (indice de capas descubribles). Sin dependencias externas. */
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

function crsShort(l: CatalogEntry): string {
  return l.defaultCrs.replace(/^urn:(x-)?ogc:def:crs:EPSG::?(\d+).*$/, 'EPSG:$2');
}

/** Card HTML del indice de capas. */
function cardHtml(l: CatalogEntry): string {
  const label = SOURCE_LABEL[l.source] ?? l.source;
  const abs = cleanText(l.abstract)
    ? `<p class="card-abs">${esc(cleanText(l.abstract))}</p>`
    : '<p class="card-abs dim">Sin descripción publicada.</p>';
  return `<article class="card" data-src="${l.source}" data-t="${esc(`${l.title} ${l.typeName}`.toLowerCase())}" data-d="${esc((l.abstract || '').toLowerCase())}" data-k="${esc(l.keywords.join(' ').toLowerCase())}">
    <h3 class="card-title">${esc(l.title)}</h3>
    ${abs}
    <div class="card-meta"><span class="src src-${l.source}">${esc(label)}</span><span class="vig">${esc(vintageLine(l))}</span></div>
    <p class="meta-line">Publica: ${esc(SOURCE_ORG[l.source] ?? label)}</p>
    <p class="meta-line">Catálogo verificado: ${esc(l.verifiedAt)}</p>
    <details class="tech"><summary>Detalles técnicos</summary><div class="tech-body"><code class="typename">${esc(l.typeName)}</code><div class="card-foot"><span class="crs">${esc(crsShort(l))}</span><span class="endpoint">${esc(l.endpoint)}</span></div></div></details>
  </article>`;
}

const cards = catalog.layers.map(cardHtml).join('\n');

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

/** Estilos de la landing (explica el MCP). */
const LANDING_CSS = `
  .hero { background: linear-gradient(135deg, #0d3b4f 0%, #0d6e8c 100%); color: #fff; padding: 52px 16px 46px; position: relative; overflow: hidden; }
  .hero-grid { display: grid; grid-template-columns: 1fr; gap: 26px; align-items: center; }
  @media (min-width: 900px) { .hero-grid { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 40px; } }
  .kicker { font-size: 12px; letter-spacing: .16em; text-transform: uppercase; opacity: .82; margin: 0 0 12px; font-weight: 600; }
  .hero h1 { font-size: clamp(32px, 7vw, 46px); margin: 0 0 12px; letter-spacing: -.01em; line-height: 1.08; }
  .hero .promise { font-size: clamp(15px, 2.4vw, 17.5px); max-width: 640px; margin: 0 0 26px; opacity: .94; }
  .hero-cta { display: flex; flex-wrap: wrap; gap: 10px; }
  .hero-map-img { display: block; width: 100%; max-width: 300px; border-radius: 16px; box-shadow: 0 12px 32px rgba(3,25,36,.45); margin: 0 auto; }
  @media (max-width: 899px) { .hero-map-img { max-width: 200px; } }
  .map-cap { font-size: 11px; opacity: .85; text-align: center; margin-top: 8px; }
  .map-cap a { color: #fff; }
  .toolgrid { display: grid; grid-template-columns: 1fr; gap: 12px; }
  @media (min-width: 760px) { .toolgrid { grid-template-columns: repeat(2, 1fr); } }
  .tool { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: #fbfdfe; }
  .tool code { display: inline-block; font-weight: 600; color: var(--brand-dark); margin-bottom: 4px; }
  .tool p { margin: 0; font-size: 13.5px; }
  .steps { list-style: none; padding: 0; margin: 0; counter-reset: s; }
  .steps li { display: flex; gap: 12px; align-items: flex-start; margin: 14px 0; font-size: 14.5px; color: #31424e; }
  .steps li::before { counter-increment: s; content: counter(s); flex: 0 0 30px; height: 30px; width: 30px; border-radius: 50%; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
  .step-title { font-weight: 600; color: var(--brand-dark); }
  pre.code { background: #0d3b4f; color: #e8f1f5; padding: 12px 14px; border-radius: 10px; overflow: auto; font-size: 12.5px; line-height: 1.5; margin: 8px 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .source-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin: 10px 0; background: #fff; }
  .source-card .org { margin: 6px 0 4px; font-size: 14px; color: #31424e; }
  .status { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--muted); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 9px; }
  .dot.live { background: #1c9c5b; }
  .dot.preserved { background: #d9930f; }
  @media (max-width: 520px) { .hero { padding: 34px 16px 30px; } }`;

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

const licensesDetails = `<details class="licenses" id="licencias">
  <summary>Licencias y atribución por fuente</summary>${LICENSE_BODY}
</details>`;

const siteFooter = `<footer class="site">
    Código MIT · Los datos son de sus organismos publicadores · Mapa © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · Generado el ${esc(catalog.generatedAt.slice(0, 10))} · <a href="${REPO}">Repositorio en GitHub</a>.
  </footer>`;

const catalogHtml = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoTucumán — Índice de capas descubribles</title>
<style>${BASE_CSS}${CATALOG_CSS}
</style>
</head>
<body>
<header class="hero-slim">
  <div class="wrap">
    <h1>GeoTucumán</h1>
    <p>Índice de capas: lo que el MCP puede descubrir hoy en los servicios oficiales. ${esc(capasLine)}. <a href="./index.html">← Volver</a></p>
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
  <p class="hint">Cada capa se consulta con la herramienta consultar_capa del MCP, o directo en el servicio oficial del organismo que la publica.</p>
  <p class="hint">Orden: primero coincidencias en el nombre de la capa, después en la descripción, al final en palabras clave genéricas.</p>
  <p class="scope">GeoTucumán descubre y sugiere datasets: cuáles existen, quién los publica, de cuándo son y cómo consultarlos. No arma mapas ni análisis: eso lo hacés vos con el dataset. Ojo: una capa muestra lo que contiene — las parcelas catastrales no dicen cuántas personas viven ahí; para población buscá capas censales.</p>
  <div class="grid" id="grid">${cards}
  </div>
  ${licensesDetails}
  <p class="dim">Catálogo generado el ${esc(catalog.generatedAt.slice(0, 10))}. ${catalog.layers.length} capas.</p>
  ${siteFooter}
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
<title>GeoTucumán — MCP de geodatos públicos de Tucumán</title>
<meta name="description" content="Un servidor MCP open source que conecta tu agente de IA con los geodatos públicos de Tucumán: descubre qué capas existen y las consulta en vivo en los servicios oficiales.">
<style>${BASE_CSS}${LANDING_CSS}
</style>
</head>
<body>
<header class="hero">
  <div class="wrap hero-grid">
   <div>
    <p class="kicker">Servidor MCP · Código abierto (MIT)</p>
    <h1>GeoTucumán</h1>
    <p class="promise">Le da a tu agente de IA acceso directo a los geodatos públicos de Tucumán: qué capas existen, quién las publica, de cuándo son, y las consulta en vivo en los servicios oficiales. Sin copiar ni alojar datos: consulta la fuente y la cita.</p>
    <div class="hero-cta">
      <a class="btn" href="#como-usar">Cómo usarlo</a>
      <a class="btn ghost" href="${REPO}">Código en GitHub</a>
    </div>
   </div>
   <div>
    <img class="hero-map-img" src="./assets/mapa-tucuman.jpg" alt="Mapa real de la provincia de Tucumán con su contorno destacado y la capital marcada">
    <p class="map-cap">Mapa © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></p>
   </div>
  </div>
</header>
<div class="wrap">
  <section class="panel">
    <h2>Qué hace</h2>
    <div class="toolgrid">
      <div class="tool"><code>buscar_capas</code><p>Descubre qué capas existen por tema o palabra clave dentro del catálogo embebido.</p></div>
      <div class="tool"><code>describir_capa</code><p>Devuelve los campos reales de una capa. Obligatorio antes de consultarla.</p></div>
      <div class="tool"><code>consultar_capa</code><p>Trae features con filtros, paginación y bbox en EPSG:4326, reproyectado al CRS nativo de cada capa.</p></div>
      <div class="tool"><code>geocodificar</code><p>Convierte una dirección en coordenadas con la API Georef (gratis, sin key).</p></div>
    </div>
    <p>Le decís a tu agente: "quiero hacer un mapa de cultivos de soja en Tucumán". GeoTucumán encuentra la capa, te dice quién la publica y de cuándo es, y la consulta en vivo.</p>
  </section>

  <section class="panel" id="como-usar">
    <h2>Cómo usarlo</h2>
    <ol class="steps">
      <li><span><span class="step-title">Cloná e instalá</span><pre class="code">git clone https://github.com/FranprzDev/geotucuman.git
cd geotucuman
npm install</pre></span></li>
      <li><span><span class="step-title">Compilá el servidor</span><pre class="code">npm run build</pre><span class="hint">Genera dist/stdio.js y dist/http.js con xmcp.</span></span></li>
      <li><span><span class="step-title">Conectalo a tu cliente MCP</span> (ejemplo Claude Code):<pre class="code">{ "mcpServers": { "geotucuman": { "command": "node", "args": ["/ruta/geotucuman/dist/stdio.js"] } } }</pre></span></li>
      <li><span><span class="step-title">Listo</span>: las cuatro herramientas quedan disponibles en tu agente.</span></li>
    </ol>
    <p class="hint">Corre local por stdio. También compila un transporte HTTP (npm run start:http) pensado para hosting futuro: hoy no hay un servidor remoto público.</p>
  </section>

  <section class="panel">
    <h2>Límites claros</h2>
    <ul>
      <li>No es un SIG ni un visor: no arma mapas ni análisis; eso lo hacés vos con los datos.</li>
      <li>No aloja ni redistribuye datasets: todas las consultas van a los servicios oficiales en vivo.</li>
      <li>No fija licencias por capa: los GetCapabilities no las publican; los términos de cada organismo están en el <a href="./capas.html#licencias">índice de capas</a>.</li>
    </ul>
  </section>

  <section class="panel">
    <h2>Cobertura y fuentes</h2>
    <p>Hoy el catálogo embebido descubre ${esc(capasLine)}, generado desde los GetCapabilities en vivo (se preserva un snapshot si un endpoint cae).</p>
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
  </section>

  <section class="panel">
    <p>Son las capas que buscar_capas puede encontrar hoy.</p>
    <p><a class="btn ghost-light" href="./capas.html">Ver el índice de capas descubribles →</a></p>
  </section>

  ${siteFooter}
</div>
</body>
</html>`;

mkdirSync('docs', { recursive: true });
writeFileSync('docs/index.html', landingHtml);
writeFileSync('docs/capas.html', catalogHtml);
console.log(`docs/index.html generado (landing MCP) y docs/capas.html generado (${catalog.layers.length} capas)`);
