/** Generates docs/index.html (MCP landing) and docs/capas.html (index of discoverable layers). No external dependencies. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Catalog, CatalogEntry } from '../src/catalog.js';
import { ENDPOINTS } from '../src/endpoints.js';

const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf-8')) as Catalog;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** IGN sometimes publishes abstracts wrapped in CDATA; they are cleaned to show plain text. */
const cleanText = (s: string) => s.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();

const REPO = 'https://github.com/FranprzDev/geotucuman';

const SOURCE_LABEL: Record<string, string> = {
  geosplan: 'Planeamiento (Geosplan) - Tucuman',
  dgct: 'Direccion General de Catastro - Tucuman',
  ign: 'Instituto Geografico Nacional - Argentina',
  rides: 'Ministerio de Produccion (RIDES) - Tucuman',
};

const SOURCE_ORG: Record<string, string> = {
  geosplan: 'Secretaría de Estado de Gestión Pública y Planeamiento, Tucumán',
  dgct: 'Dirección General de Catastro (DGCT), Tucumán',
  ign: 'Instituto Geográfico Nacional (IGN), Argentina',
  rides: 'Ministerio de Producción, Tucumán (RIDES)',
};

/** Short chip labels for the original sources; newer sources fall back to their province name. */
const SOURCE_SHORT: Record<string, string> = { geosplan: 'Planeamiento', dgct: 'Catastro', ign: 'IGN', rides: 'RIDES' };
for (const ep of ENDPOINTS) {
  if (!SOURCE_LABEL[ep.id]) SOURCE_LABEL[ep.id] = `${ep.label} - ${ep.province}`;
  if (!SOURCE_ORG[ep.id]) SOURCE_ORG[ep.id] = ep.label;
}
const provinceOf = (id: string): string => ENDPOINTS.find((e) => e.id === id)?.province ?? id;

const counts: Record<string, number> = {};
for (const l of catalog.layers) counts[l.source] = (counts[l.source] ?? 0) + 1;
const layersLine = `${Object.keys(counts)
  .map((id) => `${counts[id]} ${SOURCE_SHORT[id] ?? provinceOf(id)}`)
  .join(' · ')} = ${catalog.layers.length} capas`;

const filterButtons = Object.keys(counts)
  .map((id) => `      <button data-f="${id}">${esc(SOURCE_SHORT[id] ?? provinceOf(id))}</button>`)
  .join('\n');

/** Extracts years (19xx/20xx) and ranges (e.g. 2008-2017) from the text, without duplicating range endpoints. */
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

/** Honest data vintage line: only states the year if it appears in the name/description. */
function vintageLine(l: CatalogEntry): string {
  const years = extractYears(`${l.title} ${l.abstract} ${l.typeName}`);
  return years.length > 0
    ? `Dato: ${years.join(', ')} (según el nombre de la capa)`
    : 'Vigencia: sin indicar.';
}

function crsShort(l: CatalogEntry): string {
  return l.defaultCrs.replace(/^urn:(x-)?ogc:def:crs:EPSG::?(\d+).*$/, 'EPSG:$2');
}

/** HTML card for the layer index. */
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
    <details class="tech"><summary>Detalles técnicos</summary><div class="tech-body"><span class="service-type">${esc(l.services.map(s=>s.type.toUpperCase()).join(' / '))}</span><code class="typename">${esc(l.typeName)}</code><div class="card-foot"><span class="crs">${esc(crsShort(l))}</span><span class="endpoint">${esc(l.endpoint)}</span><span class="verified">Catálogo verificado: ${esc(l.verifiedAt)}</span></div></div></details>
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

const EXTRA_LICENSES = ENDPOINTS.filter((ep) => !['geosplan', 'dgct', 'ign', 'rides'].includes(ep.id))
  .map(
    (ep) =>
      `    <li><span class="src src-${ep.id}">${esc(SOURCE_LABEL[ep.id])}</span> <a href="${esc(ep.license.url)}">${esc(ep.license.status)}</a></li>`,
  )
  .join('\n');

const LICENSE_BODY = `
  <p>Que un servicio sea público no garantiza reutilización. Lo siguiente son los términos publicados por cada organismo a nivel sitio/servicio, no licencias por capa; revisá el enlace antes de redistribuir:</p>
  <ul>
    <li><span class="src src-geosplan">${esc(SOURCE_LABEL.geosplan)}</span> Términos publicados del sitio: <a href="http://geosplan.tucuman.gov.ar/index.php/institucional/terminos-de-uso/">"La Secretaría de Estado de Gestión Pública y Planeamiento promueve el acceso y reutilización de la información publicada en este sitio web. Comparte la información en los términos que establece las licencias Creative Commons: Reconocimiento-No comercial-Compartir Igual"</a>, con criterios: "Que el contenido de la información no sea alterado", "Que no se desnaturalice el sentido de la información", "Que se cite la fuente", "Que se mencione la fecha de la última actualización", "Que no se persigan fines comerciales con la obra original o la utilización de la información publicada".</li>
    <li><span class="src src-ign">${esc(SOURCE_LABEL.ign)}</span> Términos publicados del organismo para "información descargada del sitio web del IGN": <a href="https://www.ign.gob.ar/descargas/tyc1.html">"Debe reconocerse la autoría del Instituto Geográfico Nacional de la República Argentina. Se debe compartir de manera libre y gratuita. Se permite su uso comercial únicamente en el caso de obras derivadas en que la información sea utilizada como insumo para generar un nuevo producto. El IGN no se responsabiliza por las consecuencias de la utilización de la información descargada."</a></li>
    <li><span class="src src-dgct">${esc(SOURCE_LABEL.dgct)}</span> Términos publicados del organismo: <a href="https://catastrotucuman.gov.ar/gestiones/servicio-wms-wfs/">no se publica licencia ni términos de uso; el servicio está documentado como experimental desde 2012</a>.</li>
    <li><span class="src src-rides">${esc(SOURCE_LABEL.rides)}</span> Organismo público provincial: <a href="https://rides.producciontucuman.gob.ar/servicios-wms/">no publica licencia ni términos de reuso por capa (no verificados)</a>.</li>
${EXTRA_LICENSES}
  </ul>
  <p>Geocodificación: términos publicados del <a href="https://www.argentina.gob.ar/georef/condiciones-de-uso-y-licencia">Servicio Georef</a>: "Atribución obligatoria: se debe mencionar la fuente como 'Servicio Georef – argentina.gob.ar/georef' o incluir un enlace al sitio oficial. Indicación de modificaciones: si se redistribuye la información con cambios, debe indicarse que ha sido modificada. Uso responsable."</p>
  <p>El GetCapabilities de cada servicio no publica licencia por capa: la licencia de cada capa concreta queda sin verificar.</p>`;

/** Shared visual system for both pages. */
const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --bg: #05070c; --bg-soft: #080c14; --surface: #0b101a; --surface-2: #101623;
    --ink: #e9f1f6; --muted: #93a3b4; --muted-2: #66778a;
    --line: rgba(148,178,203,.14); --line-strong: rgba(148,178,203,.26);
    --brand: #3fd6ea; --brand-bright: #8ce9f4; --brand-deep: #0e7d95;
    --radius: 16px; --radius-sm: 12px;
    --shadow: 0 2px 10px rgba(0,0,0,.3);
    --header-h: 68px;
    color-scheme: dark;
  }
  html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; scroll-padding-top: calc(var(--header-h) + 16px); }
  body {
    font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0; color: var(--ink); line-height: 1.6; min-height: 100vh;
    background-color: var(--bg);
    background-image:
      radial-gradient(900px 540px at 50% -220px, rgba(63,214,234,.17), transparent 70%),
      linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
    background-repeat: no-repeat, repeat, repeat;
    background-size: auto, 48px 48px, 48px 48px;
    background-attachment: fixed, fixed, fixed;
  }
  a { color: var(--brand); text-decoration-color: rgba(63,214,234,.45); text-underline-offset: 3px; }
  a:hover { color: var(--brand-bright); }
  a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--brand-bright); outline-offset: 3px; border-radius: 8px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; background: rgba(63,214,234,.09); color: var(--brand-bright); border: 1px solid rgba(63,214,234,.16); padding: 1px 6px; border-radius: 6px; word-break: break-word; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; width: 100%; }
  .skip { position: absolute; left: 16px; top: -64px; z-index: 100; background: var(--brand); color: #041016; padding: 10px 14px; border-radius: 10px; font-weight: 700; text-decoration: none; }
  .skip:focus { top: 12px; }
  .site-header { position: sticky; top: 0; z-index: 50; background: rgba(5,7,12,.68); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); }
  .header-inner { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: var(--header-h); }
  .brand { display: inline-flex; align-items: center; gap: 9px; color: var(--ink); text-decoration: none; font-size: 18px; font-weight: 750; letter-spacing: -.025em; }
  .brand:hover { color: var(--ink); }
  .brand svg { width: 22px; height: 22px; color: var(--brand); filter: drop-shadow(0 0 10px rgba(63,214,234,.55)); }
  .nav { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .nav a { color: var(--muted); text-decoration: none; font-size: 13.5px; font-weight: 600; padding: 8px 11px; border-radius: 999px; }
  .nav a:hover { color: var(--ink); background: rgba(255,255,255,.05); }
  .nav a[aria-current="page"] { color: var(--brand-bright); }
  .panel { background: linear-gradient(180deg, rgba(20,24,36,.94), rgba(13,15,24,.94)); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: clamp(20px, 4vw, 36px); margin: 20px 0; }
  .panel > h2, .section-head h2 { font-size: clamp(22px, 3vw, 30px); line-height: 1.15; letter-spacing: -.025em; font-weight: 750; color: var(--ink); margin: 0 0 16px; }
  .panel p, .panel li { font-size: 14.5px; color: #a6b4c0; }
  .eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--brand); font-weight: 700; margin: 0 0 10px; }
  .card { min-width: 0; background: linear-gradient(180deg, rgba(22,26,39,.96), rgba(15,18,28,.97)); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 10px 30px rgba(0,0,0,.3); padding: 18px 20px; transition: border-color .2s ease, transform .2s ease, box-shadow .2s ease; }
  .card:hover { border-color: rgba(63,214,234,.36); transform: translateY(-2px); box-shadow: 0 18px 50px rgba(0,0,0,.45); }
  h3.card-title { font-size: 17px; margin: 0 0 7px; color: var(--ink); line-height: 1.3; letter-spacing: -.01em; }
  h3.card-title, .card-abs, .card-foot, code.typename { overflow-wrap: anywhere; }
  h3.card-title.tools-title { margin-top: 30px; }
  code.typename { font-size: 12px; word-break: break-all; display: inline-block; }
  .card-abs { font-size: 13.5px; color: #a6b4c0; margin: 8px 0; }
  .card-abs.dim { color: var(--muted-2); font-style: italic; }
  .card-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0 4px; }
  .vig { font-size: 12px; color: var(--muted); }
  .meta-line { font-size: 12px; color: var(--muted-2); margin: 4px 0 0; }
  .card-foot { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 8px; }
  .crs { font-size: 11.5px; color: var(--muted); }
  .endpoint { font-size: 11px; color: var(--muted-2); word-break: break-all; }
  .src { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 650; padding: 3px 8px; border-radius: 999px; border: 1px solid transparent; background: rgba(148,178,203,.10); color: #b6c6d4; border-color: rgba(148,178,203,.22); }
  .src-geosplan { background: rgba(52,211,153,.12); color: #6ee7b7; border-color: rgba(52,211,153,.24); }
  .src-dgct { background: rgba(251,191,36,.12); color: #fcd34d; border-color: rgba(251,191,36,.24); }
  .src-ign { background: rgba(96,165,250,.13); color: #93c5fd; border-color: rgba(96,165,250,.26); }
  .src-georef { background: rgba(167,139,250,.13); color: #c4b5fd; border-color: rgba(167,139,250,.26); }
  .src-rides { background: rgba(244,114,182,.13); color: #f9a8d4; border-color: rgba(244,114,182,.26); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; background: var(--brand); color: #041016; text-decoration: none; padding: 11px 20px; border-radius: 999px; font-size: 14px; font-weight: 700; border: 1px solid transparent; cursor: pointer; transition: transform .2s ease, box-shadow .2s ease, background .2s ease; }
  .btn:hover { transform: translateY(-1px); color: #041016; }
  .btn.primary { background: linear-gradient(135deg, #2bd0ee, #0f8ba7); color: #031015; box-shadow: 0 0 0 1px rgba(127,227,242,.25), 0 14px 40px rgba(63,214,234,.28); }
  .btn.primary:hover { box-shadow: 0 0 0 1px rgba(127,227,242,.4), 0 18px 50px rgba(63,214,234,.4); }
  .btn.ghost { background: rgba(255,255,255,.03); color: var(--ink); border-color: var(--line-strong); }
  .btn.ghost:hover { background: rgba(255,255,255,.07); color: #fff; }
  .btn.ghost-light { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .dim { color: var(--muted-2); }
  .hint { font-size: 12.5px; color: var(--muted); margin-top: 8px; }
  .scope { font-size: 13px; color: #9aa8b5; margin-top: 10px; line-height: 1.6; }
  details.licenses { background: linear-gradient(180deg, rgba(20,24,36,.94), rgba(13,15,24,.94)); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 4px 24px; margin: 20px 0; }
  details.licenses > summary { cursor: pointer; font-size: clamp(18px, 2.4vw, 22px); font-weight: 700; color: var(--ink); padding: 16px 0; list-style: none; }
  details.licenses > summary::-webkit-details-marker { display: none; }
  details.licenses > summary::before { content: "▸ "; color: var(--brand); }
  details.licenses[open] > summary::before { content: "▾ "; }
  details.licenses p, details.licenses li { font-size: 13px; color: #9aa8b5; line-height: 1.55; }
  details.licenses ul { margin: 8px 0; padding-left: 18px; }
  details.licenses li { margin: 6px 0; }
  details.licenses a { color: var(--brand-bright); }
  footer.site { font-size: 12.5px; color: var(--muted); margin: 28px 0 54px; padding-top: 20px; border-top: 1px solid var(--line); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  details.tech { margin-top: 10px; }
  details.tech > summary { cursor: pointer; font-size: 12.5px; color: var(--muted); font-weight: 600; list-style: none; }
  details.tech > summary::-webkit-details-marker { display: none; }
  details.tech > summary::before { content: "> "; color: var(--brand); }
  details.tech[open] > summary::before { content: "v "; }
  details.tech .tech-body { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
  .js .reveal { opacity: 0; transform: translateY(16px); transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .js .reveal.is-visible { opacity: 1; transform: none; }
  @media (max-width: 520px) { .nav a { padding: 8px 7px; font-size: 12.5px; } .brand { font-size: 16px; } .wrap { padding: 0 16px; } }
  h1, h2, h3, .brand { font-family: "Space Grotesk", "Inter", ui-sans-serif, sans-serif; letter-spacing: -.02em; }
  .nav a.nav-cta { color: #04141a; background: var(--brand); font-weight: 600; margin-left: 6px; }
  .nav a.nav-cta:hover { background: var(--brand-bright); color: #04141a; }
  footer.site { display: flex; justify-content: space-between; gap: 10px 18px; flex-wrap: wrap; }
  footer.site .made { color: var(--muted-2); }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .js .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
    .card:hover, .btn:hover { transform: none; }
    .tagline-word { color: var(--ink) !important; transition: none !important; }
  }`;

/** Landing styles (explains the MCP). */
const CATALOG_CSS = `
  .hero-slim { position: relative; overflow: hidden; padding: clamp(34px, 6vw, 58px) 20px clamp(30px, 5vw, 48px); border-bottom: 1px solid var(--line); }
  .hero-slim::before { content: ""; position: absolute; inset: -40% -10% auto; height: 150%; background: radial-gradient(ellipse at 50% 0%, rgba(63,214,234,.2), transparent 64%); pointer-events: none; }
  .hero-slim .wrap { position: relative; }
  .hero-slim h1 { font-size: clamp(28px, 4.4vw, 44px); line-height: 1.08; letter-spacing: -.035em; margin: 0 0 8px; color: var(--ink); }
  .hero-slim p { margin: 0; font-size: 14.5px; color: var(--muted); max-width: 760px; }
  .hero-slim a { color: var(--brand-bright); font-size: 13px; }
  .controls { position: sticky; top: var(--header-h); z-index: 20; background: rgba(9,10,16,.88); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); padding: 14px 0 12px; border-bottom: 1px solid var(--line); }
  #q { width: 100%; min-height: 50px; font-size: 16px; padding: 12px 18px; border: 1px solid var(--line-strong); border-radius: 999px; background: rgba(17,20,31,.9); color: var(--ink); }
  #q::placeholder { color: var(--muted-2); }
  #q:focus { border-color: rgba(63,214,234,.6); box-shadow: 0 0 0 4px rgba(63,214,234,.12); outline: none; }
  .filters { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .filters button { min-height: 44px; font-size: 13.5px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line-strong); background: rgba(255,255,255,.03); color: var(--muted); cursor: pointer; font-weight: 650; }
  .filters button:hover { color: var(--ink); border-color: rgba(63,214,234,.35); }
  .filters button.on { background: linear-gradient(135deg, #2bd0ee, #0f8ba7); color: #031015; border-color: transparent; box-shadow: 0 0 20px rgba(63,214,234,.22); }
  #count { font-size: 14px; font-weight: 650; color: var(--brand-bright); margin-top: 10px; }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; margin-top: 8px; }
  @media (min-width: 760px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 759px) { .controls { position: static; } .card { scroll-margin-top: 80px; } }`;

const licensesDetails = `<details class="licenses" id="licencias">
  <summary>Licencias y atribución por fuente</summary>${LICENSE_BODY}
</details>`;

const siteFooter = `<footer class="site">
      <span>Código MIT · Los datos son de sus organismos publicadores · <a href="${REPO}">Repositorio en GitHub</a></span>
      <span class="made">Hecho por FranPrzDev</span>
    </footer>`;



const catalogHtml = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoArg — Índice de capas descubribles</title>
<meta name="description" content="Índice de capas descubribles de GeoArg: qué geodatos públicos existen en los servicios oficiales, quién los publica y de cuándo son.">
<script>if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.classList.add('js');</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${BASE_CSS}${CATALOG_CSS}
</style>
</head>
<body>
<a class="skip" href="#main">Saltar al contenido</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="./index.html" aria-label="GeoArg, inicio">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/></svg>
      <span>GeoArg</span>
    </a>
    <nav class="nav" aria-label="Principal">
      <a href="./capas.html" aria-current="page">Capas</a>
      <a class="nav-cta" href="${REPO}">GitHub</a>
    </nav>
  </div>
</header>
<section class="hero-slim" aria-labelledby="catalog-title">
  <div class="wrap">
    <p class="eyebrow">Catálogo de capas</p>
    <h1 id="catalog-title">Índice de capas descubribles</h1>
    <p>Las capas que GeoArg encuentra hoy en los servicios oficiales: ${esc(layersLine)}. <a href="./index.html">← Volver al inicio</a></p>
  </div>
</section>
<main id="main" class="wrap">
  <div class="controls">
    <input id="q" type="search" placeholder='Buscar por tema o palabra: "agua", "cultivos", "calles"...' aria-label="Buscar en el catálogo">
    <div class="filters">
      <button data-f="" class="on">Todas</button>
${filterButtons}
    </div>
    <div id="count"></div>
  </div>
  <div class="grid" id="grid">${cards}
  </div>
  <details class="licenses"><summary>Qué hace GeoArg (y qué no)</summary>
  <p>Encuentra y sugiere datasets: cuáles existen, quién los publica, de cuándo son y cómo consultarlos. No arma mapas ni análisis: eso lo hacés vos con el dataset. Ojo: una capa muestra lo que contiene — las parcelas catastrales no dicen cuántas personas viven ahí; para población buscá capas censales.</p>
  </details>
  ${licensesDetails}
  ${siteFooter}
</main>
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
    ? '0 capas para esta búsqueda. El catálogo reúne fuentes oficiales (WFS, WMS y ArcGIS REST) + Georef; la capa que buscás puede no estar publicada en estas fuentes.'
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

mkdirSync('docs', { recursive: true });
// docs/index.html (landing) is hand-authored; this script only generates the catalog.
writeFileSync('docs/capas.html', catalogHtml);
console.log(`docs/capas.html generated (${catalog.layers.length} layers)`);
