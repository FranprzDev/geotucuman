/** Generates docs/mcp.html and docs/capas.html, and keeps metadata/docs links on the hand-authored landing. No external dependencies. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Catalog, CatalogEntry } from '../src/catalog.js';
import { ENDPOINTS } from '../src/endpoints.js';

const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf-8')) as Catalog;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** IGN sometimes publishes abstracts wrapped in CDATA; they are cleaned to show plain text. */
const cleanText = (s: string) => s.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();

const REPO = 'https://github.com/FranprzDev/geotucuman';
const WEB = 'https://franprzdev.github.io/geotucuman';
const MCP_ENDPOINT = 'https://geoarg-mcp.franprzdev.workers.dev/mcp';

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
  .map((ep) => {
    const attribution = ep.id.startsWith('inta_') ? ` ${esc(ep.license.attribution)}` : '';
    return `    <li><span class="src src-${ep.id}">${esc(SOURCE_LABEL[ep.id])}</span> <a href="${esc(ep.license.url)}">${esc(ep.license.status)}</a>${attribution}</li>`;
  })
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
  <p>Para las fuentes anteriores sin licencia por capa verificada, el acceso no implica permiso de redistribución. En las siete capas INTA se revisaron los metadatos originales enlazados; respetá sus condiciones, fechas y límites. GeoArg indexa metadatos y enlaces, no aloja ni redistribuye esos raster o vectores.</p>`;

/** Shared visual system for both pages. */
const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --bg: #05070c; --bg-soft: #080c14; --surface: #0b101a; --surface-2: #101623;
    --ink: #e9f1f6; --muted: #93a3b4; --muted-2: #66778a;
    --line: rgba(148,178,203,.14); --line-strong: rgba(148,178,203,.26);
    --brand: #4ade80; --brand-bright: #a7f3c7; --brand-deep: #15803d;
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
      radial-gradient(900px 540px at 50% -220px, rgba(74,222,128,.17), transparent 70%),
      linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
    background-repeat: no-repeat, repeat, repeat;
    background-size: auto, 48px 48px, 48px 48px;
    background-attachment: fixed, fixed, fixed;
  }
  a { color: var(--brand); text-decoration-color: rgba(74,222,128,.45); text-underline-offset: 3px; }
  a:hover { color: var(--brand-bright); }
  a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--brand-bright); outline-offset: 3px; border-radius: 8px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; background: rgba(74,222,128,.09); color: var(--brand-bright); border: 1px solid rgba(74,222,128,.16); padding: 1px 6px; border-radius: 6px; word-break: break-word; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; width: 100%; }
  .skip { position: absolute; left: 16px; top: -64px; z-index: 100; background: var(--brand); color: #04160c; padding: 10px 14px; border-radius: 10px; font-weight: 700; text-decoration: none; }
  .skip:focus { top: 12px; }
  .site-header { position: sticky; top: 0; z-index: 50; background: rgba(5,7,12,.68); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); }
  .header-inner { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: var(--header-h); }
  .brand { display: inline-flex; align-items: center; gap: 9px; color: var(--ink); text-decoration: none; font-size: 18px; font-weight: 750; letter-spacing: -.025em; }
  .brand:hover { color: var(--ink); }
  .brand svg { width: 22px; height: 22px; color: var(--brand); filter: drop-shadow(0 0 10px rgba(74,222,128,.55)); }
  .nav { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .nav a { color: var(--muted); text-decoration: none; font-size: 13.5px; font-weight: 600; padding: 8px 11px; border-radius: 999px; }
  .nav a:hover { color: var(--ink); background: rgba(255,255,255,.05); }
  .nav a[aria-current="page"] { color: var(--brand-bright); }
  .panel { background: linear-gradient(180deg, rgba(20,24,36,.94), rgba(13,15,24,.94)); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: clamp(20px, 4vw, 36px); margin: 20px 0; }
  .panel > h2, .section-head h2 { font-size: clamp(22px, 3vw, 30px); line-height: 1.15; letter-spacing: -.025em; font-weight: 750; color: var(--ink); margin: 0 0 16px; }
  .panel p, .panel li { font-size: 14.5px; color: #a6b4c0; }
  .eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--brand); font-weight: 700; margin: 0 0 10px; }
  .card { min-width: 0; background: linear-gradient(180deg, rgba(22,26,39,.96), rgba(15,18,28,.97)); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 10px 30px rgba(0,0,0,.3); padding: 18px 20px; transition: border-color .2s ease, transform .2s ease, box-shadow .2s ease; }
  .card:hover { border-color: rgba(74,222,128,.36); transform: translateY(-2px); box-shadow: 0 18px 50px rgba(0,0,0,.45); }
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
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; background: var(--brand); color: #04160c; text-decoration: none; padding: 11px 20px; border-radius: 999px; font-size: 14px; font-weight: 700; border: 1px solid transparent; cursor: pointer; transition: transform .2s ease, box-shadow .2s ease, background .2s ease; }
  .btn:hover { transform: translateY(-1px); color: #04160c; }
  .btn.primary { background: linear-gradient(135deg, #4ade80, #15803d); color: #03200f; box-shadow: 0 0 0 1px rgba(167,243,199,.25), 0 14px 40px rgba(74,222,128,.28); }
  .btn.primary:hover { box-shadow: 0 0 0 1px rgba(167,243,199,.4), 0 18px 50px rgba(74,222,128,.4); }
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
  .nav a.nav-cta { color: #04160c; background: var(--brand); font-weight: 600; margin-left: 6px; }
  .nav a.nav-cta:hover { background: var(--brand-bright); color: #04160c; }
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
  .hero-slim::before { content: ""; position: absolute; inset: -40% -10% auto; height: 150%; background: radial-gradient(ellipse at 50% 0%, rgba(74,222,128,.2), transparent 64%); pointer-events: none; }
  .hero-slim .wrap { position: relative; }
  .hero-slim h1 { font-size: clamp(28px, 4.4vw, 44px); line-height: 1.08; letter-spacing: -.035em; margin: 0 0 8px; color: var(--ink); }
  .hero-slim p { margin: 0; font-size: 14.5px; color: var(--muted); max-width: 760px; }
  .hero-slim a { color: var(--brand-bright); font-size: 13px; }
  .controls { position: sticky; top: var(--header-h); z-index: 20; background: rgba(9,10,16,.88); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); padding: 14px 0 12px; border-bottom: 1px solid var(--line); }
  #q { width: 100%; min-height: 50px; font-size: 16px; padding: 12px 18px; border: 1px solid var(--line-strong); border-radius: 999px; background: rgba(17,20,31,.9); color: var(--ink); }
  #q::placeholder { color: var(--muted-2); }
  #q:focus { border-color: rgba(74,222,128,.6); box-shadow: 0 0 0 4px rgba(74,222,128,.12); outline: none; }
  .filters { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .filters button { min-height: 44px; font-size: 13.5px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line-strong); background: rgba(255,255,255,.03); color: var(--muted); cursor: pointer; font-weight: 650; }
  .filters button:hover { color: var(--ink); border-color: rgba(74,222,128,.35); }
  .filters button.on { background: linear-gradient(135deg, #4ade80, #15803d); color: #03200f; border-color: transparent; box-shadow: 0 0 20px rgba(74,222,128,.22); }
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



const mcpDocHtml = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoArg MCP: documentación y conexión</title>
<meta name="description" content="Cómo conectar GeoArg, MCP de descubrimiento y consulta de geodatos públicos de Argentina. Endpoint HTTP público, instalación local por stdio, herramientas, atribución y límites de cobertura.">
<link rel="canonical" href="${WEB}/mcp.html">
<meta property="og:title" content="GeoArg MCP: documentación y conexión">
<meta property="og:description" content="Endpoint público Streamable HTTP, instalación local por stdio, herramientas y límites de GeoArg.">
<meta property="og:type" content="article">
<meta property="og:url" content="${WEB}/mcp.html">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z' fill='none' stroke='%234ade80' stroke-width='1.7'/%3E%3Ccircle cx='12' cy='10' r='2.6' fill='%234ade80'/%3E%3C/svg%3E">
<script type="application/ld+json">{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "GeoArg",
  "description": "Servidor MCP de código abierto (MIT) para descubrir y consultar geodatos públicos de Argentina por stdio local o Streamable HTTP. Solo lectura y sin API key.",
  "url": "${WEB}/mcp.html",
  "codeRepository": "${REPO}",
  "license": "https://opensource.org/licenses/MIT",
  "isAccessibleForFree": true
}</script>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --bg: #05070c; --surface: #0b101a; --surface-2: #101623;
    --ink: #e9f1f6; --muted: #93a3b4; --faint: #66778a;
    --line: rgba(148,178,203,.14); --line-strong: rgba(148,178,203,.26);
    --accent: #4ade80; --accent-soft: #a7f3c7;
    --maxw: 920px; --header-h: 68px;
    color-scheme: dark;
  }
  html { -webkit-text-size-adjust: 100%; scroll-padding-top: calc(var(--header-h) + 16px); }
  body {
    font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0; color: var(--ink); line-height: 1.65; min-height: 100vh;
    background-color: var(--bg);
    background-image:
      radial-gradient(900px 540px at 50% -220px, rgba(74,222,128,.17), transparent 70%),
      linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
    background-repeat: no-repeat, repeat, repeat;
    background-size: auto, 48px 48px, 48px 48px;
    background-attachment: fixed, fixed, fixed;
  }
  a { color: var(--accent); text-decoration-color: rgba(74,222,128,.45); text-underline-offset: 3px; }
  a:hover { color: var(--accent-soft); }
  a:focus-visible { outline: 2px solid var(--accent-soft); outline-offset: 3px; border-radius: 8px; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  code { font-size: 12.5px; background: rgba(74,222,128,.09); color: var(--accent-soft); border: 1px solid rgba(74,222,128,.16); padding: 1px 6px; border-radius: 6px; overflow-wrap: anywhere; }
  pre { margin: 12px 0 18px; padding: 14px 16px; overflow-x: auto; background: var(--surface-2); border: 1px solid var(--line-strong); border-radius: 12px; }
  pre code { display: block; padding: 0; border: 0; background: none; color: var(--ink); overflow-wrap: normal; white-space: pre; }
  .wrap { max-width: var(--maxw); margin: 0 auto; padding: 0 20px; width: 100%; }
  .skip { position: absolute; left: 16px; top: -64px; z-index: 100; background: var(--accent); color: #04160c; padding: 10px 14px; border-radius: 10px; font-weight: 700; text-decoration: none; }
  .skip:focus { top: 12px; }
  .site-header { position: sticky; top: 0; z-index: 50; background: rgba(5,7,12,.78); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); }
  .header-inner { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: var(--header-h); }
  .brand { display: inline-flex; align-items: center; gap: 9px; color: var(--ink); text-decoration: none; font-size: 18px; font-weight: 700; letter-spacing: -.025em; }
  .brand svg { width: 22px; height: 22px; color: var(--accent); }
  .nav { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .nav a { color: var(--muted); text-decoration: none; font-size: 13.5px; font-weight: 600; padding: 8px 11px; border-radius: 999px; }
  .nav a:hover { color: var(--ink); background: rgba(255,255,255,.05); }
  .nav a[aria-current="page"] { color: var(--accent-soft); }
  .nav a.nav-cta { color: #04160c; background: var(--accent); font-weight: 600; margin-left: 6px; }
  .nav a.nav-cta:hover { background: var(--accent-soft); color: #04160c; }
  main { display: block; padding-bottom: 24px; }
  .hero { padding: clamp(36px, 6vw, 64px) 0 26px; border-bottom: 1px solid var(--line); }
  .eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); font-weight: 700; margin: 0 0 10px; }
  h1, h2, h3 { font-family: "Space Grotesk", "Inter", ui-sans-serif, sans-serif; letter-spacing: -.025em; line-height: 1.15; }
  h1 { font-size: clamp(30px, 5vw, 46px); margin: 0 0 14px; }
  h2 { font-size: clamp(22px, 3vw, 30px); margin: 36px 0 12px; }
  h3 { font-size: 18px; margin: 24px 0 8px; }
  p, li { color: #a6b4c0; font-size: 15px; }
  .lede { font-size: clamp(16px, 2vw, 18px); color: var(--muted); max-width: 72ch; }
  .summary { margin-top: 20px; padding: 16px 18px; border-left: 3px solid var(--accent); background: rgba(11,16,26,.75); border-radius: 0 12px 12px 0; }
  .summary p { margin: 0; font-size: 14px; }
  .panel { margin: 22px 0; padding: 18px 20px; background: linear-gradient(180deg, rgba(20,24,36,.94), rgba(13,15,24,.94)); border: 1px solid var(--line); border-radius: 16px; }
  .panel p:last-child, .panel ul:last-child { margin-bottom: 0; }
  ul { padding-left: 22px; }
  li { margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0 4px; font-size: 14px; }
  th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  th { color: var(--ink); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
  td { color: #a6b4c0; }
  .links { display: flex; flex-wrap: wrap; gap: 8px 14px; padding: 0; list-style: none; }
  .links li { margin: 0; }
  footer.site { margin-top: 34px; padding: 20px 0 38px; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--faint); }
  footer.site .wrap { display: flex; justify-content: space-between; align-items: baseline; gap: 10px 18px; flex-wrap: wrap; }
  @media (max-width: 640px) {
    .header-inner { align-items: flex-start; flex-direction: column; gap: 6px; padding: 10px 0; }
    .nav { gap: 0; }
    .nav a { padding: 8px 7px; font-size: 12.5px; }
    .nav a.nav-cta { margin-left: 0; }
    .wrap { padding: 0 16px; }
    footer.site .wrap { flex-direction: column; align-items: flex-start; }
    table, thead, tbody, th, td, tr { display: block; }
    th { padding-bottom: 4px; }
    td { padding-top: 0; border-bottom: 0; }
    tr { padding: 10px 0; border-bottom: 1px solid var(--line); }
  }
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
      <a href="./capas.html">Capas</a>
      <a href="./salud.html">Salud de capas</a>
      <a href="./mcp.html" aria-current="page">Documentación MCP</a>
      <a class="nav-cta" href="${REPO}">GitHub</a>
    </nav>
  </div>
</header>
<main id="main" class="wrap">
  <section class="hero" aria-labelledby="mcp-title">
    <p class="eyebrow">Documentación MCP</p>
    <h1 id="mcp-title">GeoArg: geodatos públicos de Argentina para tu agente</h1>
    <p class="lede">GeoArg es un servidor MCP (Model Context Protocol) para descubrir y consultar geodatos públicos de Argentina. Se puede usar local por stdio o contra el endpoint público Streamable HTTP. Es gratis, de código abierto (MIT), de solo lectura y no requiere API key.</p>
    <div class="summary">
      <p><strong>English summary:</strong> GeoArg is a free, open-source (MIT) Model Context Protocol server for discovering and querying Argentine public geodata. It runs locally over stdio or through a public Streamable HTTP endpoint. It is read-only, needs no API key, and represents 22 provinces plus CABA, 23 of 24 Argentine jurisdictions; Formosa has no working source. Coverage depends on the specific catalog layers and their limitations. WMS layers are display imagery, while WFS and ArcGIS REST layers are queryable. Third-party services may change or fail.</p>
    </div>
  </section>

  <section aria-labelledby="que-es">
    <h2 id="que-es">Qué es y nombres anteriores</h2>
    <p>GeoArg indexa metadatos de servicios oficiales WFS, WMS y ArcGIS REST, más la API Georef, y permite que un agente busque capas, las describa y consulte datos en vivo. No es un SIG completo, ni un visor, ni una copia de los datos: enlaza la fuente y devuelve su atribución cuando está disponible.</p>
    <p>El proyecto se llamó antes <strong>GeoTucumán</strong> y luego <strong>GeoMCP</strong>; el nombre visible pasó a <strong>GeoArg</strong> el 7/11/2026. El repositorio y la URL pública siguen en la ruta <code>geotucuman</code>.</p>
  </section>

  <section aria-labelledby="conexion">
    <h2 id="conexion">Conexión</h2>
    <h3>Endpoint público por Streamable HTTP</h3>
    <p>Endpoint MCP: <code>${MCP_ENDPOINT}</code></p>
    <p>Es stateless, de solo lectura y no requiere API key. JSON genérico para un cliente MCP:</p>
    <pre><code>{
  "mcpServers": {
    "geoarg": {
      "url": "${MCP_ENDPOINT}"
    }
  }
}</code></pre>
    <p>Claude Code, en una línea (comando documentado por Claude Code; no se verificó su ejecución en Claude desde este repositorio):</p>
    <pre><code>claude mcp add --transport http geoarg ${MCP_ENDPOINT}</code></pre>
    <p>El endpoint público depende de Cloudflare Workers y de servicios oficiales de terceros. Puede fallar, demorar o cambiar sin aviso, y GeoArg no controla su disponibilidad. Para uso local, el transporte por stdio no depende de ese Worker.</p>

    <h3>Instalación local por stdio</h3>
    <pre><code>git clone https://github.com/franprzdev/geotucuman.git
cd geotucuman
npm install
npm run build</code></pre>
    <p>Configuración genérica por stdio, reemplazando la ruta por la de tu copia:</p>
    <pre><code>{
  "mcpServers": {
    "geoarg": {
      "command": "node",
      "args": ["/ruta/geotucuman/dist/stdio.js"]
    }
  }
}</code></pre>
  </section>

  <section aria-labelledby="herramientas">
    <h2 id="herramientas">Cinco herramientas principales</h2>
    <table>
      <thead><tr><th>Tool</th><th>Qué hace y ejemplo real</th></tr></thead>
      <tbody>
        <tr><td><code>search_layers</code></td><td>Busca capas por palabra clave. Ejemplo: <code>query: "aeropuerto"</code> con <code>province: "Tucumán"</code> devuelve <code>WFS_GEOSPLAN:aeropuerto</code>.</td></tr>
        <tr><td><code>suggest_layers</code></td><td>Sugiere capas desde un objetivo en texto libre, sin LLM. Ejemplo: <code>goal: "quiero armar un mapa de riego y pozos"</code>.</td></tr>
        <tr><td><code>describe_layer</code></td><td>Muestra los campos reales de una capa y es obligatorio antes de consultar. Ejemplo: <code>typeName: "dgct:PARCELASR1"</code>.</td></tr>
        <tr><td><code>query_layer</code></td><td>Consulta features de capas WFS o ArcGIS REST. El bbox va en EPSG:4326, se reproyecta al CRS nativo y acepta hasta 50 features con paginación. Ejemplo: <code>typeName: "dgct:PARCELASR1"</code> después de <code>describe_layer</code>.</td></tr>
        <tr><td><code>geocode</code></td><td>Convierte texto libre en coordenadas con la API Georef, gratis y sin key. Ejemplo: <code>text: "Yerba Buena, Tucumán"</code>.</td></tr>
      </tbody>
    </table>
    <p>Las capas WMS-only se pueden buscar y describir (metadatos vía GetCapabilities), pero <code>query_layer</code> no aplica: WMS entrega imágenes de mapa para visualización, mientras que WFS y ArcGIS REST entregan features consultables. Las 7 fuentes INTA integradas son WMS-only y usan una lista blanca de una capa por fuente.</p>
  </section>

  <section aria-labelledby="datos">
    <h2 id="datos">Datos, atribución y cobertura</h2>
    <p>GeoArg no aloja ni redistribuye los datos: consulta servicios oficiales en vivo y devuelve la fuente. Cada organismo publica sus propios términos y licencias, que pueden variar por capa y deben revisarse antes de redistribuir o reutilizar. Que un servicio sea público no implica permiso de reutilización.</p>
    <p>La cobertura alcanza 23 de las 24 jurisdicciones argentinas: están representadas 22 provincias + CABA, además del IGN nacional y la API Georef. <strong>Formosa no tiene una fuente operativa integrada</strong>: su IDE responde la portada pero cierra las conexiones WMS/WFS desde fuera de Argentina, según el diagnóstico del repositorio. Las Islas Malvinas no tienen una capa dedicada ni cobertura completa: solo pueden aparecer en capas específicas del catálogo, como las de Tierra del Fuego o del IGN nacional, con sus propios límites de cobertura.</p>
    <p>La representación territorial y temática no es uniforme ni exhaustiva. En las fuentes INTA se indexa una sola capa por nodo; por ejemplo, Corrientes cubre el área cartografiada de Lomas Arenosas y no toda la provincia, Chubut aporta una capa regional Patagonia Sur sin recorte provincial, La Rioja es cobertura histórica 2006-2007 y La Pampa es productividad modelada 2001-2011 / series 2000-2013. La disponibilidad depende de terceros y puede cambiar sin aviso.</p>
  </section>

  <section aria-labelledby="enlaces">
    <h2 id="enlaces">Enlaces útiles</h2>
    <ul class="links">
      <li><a href="./capas.html">Catálogo de capas</a></li>
      <li><a href="./salud.html">Salud de capas</a></li>
      <li><a href="./ejemplos/focos-tucuman.html">Ejemplo aplicado: focos de calor vs agua en Tucumán</a></li>
      <li><a href="${MCP_ENDPOINT.replace(/\/mcp$/, '/')}">Info del servicio HTTP</a></li>
      <li><a href="${REPO}">Repositorio en GitHub</a></li>
      <li><a href="./llms.txt">Índice llms.txt (opcional)</a></li>
    </ul>
  </section>
</main>
<footer class="site">
  <div class="wrap">
    <span>GeoArg · Código MIT · Los datos son de sus organismos publicadores</span>
    <span><a href="./index.html">Volver al inicio</a></span>
  </div>
</footer>
</body>
</html>`;

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
      <a href="./salud.html">Salud de capas</a>
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

/** Adds the canonical URL and documentation links without replacing the hand-authored landing design. */
function syncLandingMetadata(): void {
  const path = 'docs/index.html';
  let html = readFileSync(path, 'utf-8');
  const canonical = `<link rel="canonical" href="${WEB}/">`;
  if (!html.includes('rel="canonical"')) {
    html = html.replace('</head>', `${canonical}\n</head>`);
  }

  const navStart = html.indexOf('<nav class="nav"');
  const navEnd = navStart >= 0 ? html.indexOf('</nav>', navStart) : -1;
  if (navStart >= 0 && navEnd > navStart && !html.slice(navStart, navEnd).includes('href="./mcp.html"')) {
    html = html.replace(
      '      <a href="./salud.html">Salud de capas</a>',
      '      <a href="./salud.html">Salud de capas</a>\n      <a href="./mcp.html">Documentación MCP</a>',
    );
  }

  const footerStart = html.indexOf('<footer class="site">');
  if (footerStart >= 0 && !html.slice(footerStart).includes('href="./mcp.html"')) {
    html = html.replace(
      ' · Geometría del mapa: Georef (datos.gob.ar)</span>',
      ' · <a href="./mcp.html">Documentación MCP</a> · Geometría del mapa: Georef (datos.gob.ar)</span>',
    );
  }
  writeFileSync(path, html);
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/capas.html', catalogHtml);
writeFileSync('docs/mcp.html', `${mcpDocHtml.replace(/\n+$/, '')}\n`);
syncLandingMetadata();
console.log(`docs/capas.html generated (${catalog.layers.length} layers)`);
console.log('docs/mcp.html generated');
console.log('docs/index.html metadata and documentation links checked');
