/** Genera docs/index.html (miniweb publica) y docs/capas.html (catalogo de capas). Sin dependencias externas. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Catalog, CatalogEntry } from '../src/catalog.js';

const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf-8')) as Catalog;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

function freshnessStatus(id: string): string {
  const s = catalog.sources[id];
  if (!s) return '';
  return s.status === 'live'
    ? `actualizado ${s.fetchedAt.slice(0, 10)}`
    : `sin actualizar (endpoint caido); capas del snapshot del ${s.fetchedAt.slice(0, 10)}`;
}

function freshnessLine(id: string): string {
  return `${SOURCE_LABEL[id] ?? id}: ${freshnessStatus(id)}`;
}

const freshness = Object.entries(catalog.sources)
  .map(([id]) => freshnessLine(id))
  .map(esc)
  .join('<br>');

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
    : 'Vigencia del dato: sin indicar.';
}

/** URL de descarga WFS para una capa, sin limite de cantidad de features. */
function downloadUrl(l: CatalogEntry, outputFormat: string): string {
  return `${l.endpoint}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${l.typeName}&outputFormat=${outputFormat}&srsName=EPSG:4326`;
}

/** Linea "Descargar:" con GeoJSON y Shapefile (.zip) por capa. */
function downloadLine(l: CatalogEntry): string {
  const geojson = downloadUrl(l, 'application%2Fjson');
  const shapefile = downloadUrl(l, 'shape-zip');
  return `<p class="downloads">Descargar: <a href="${esc(geojson)}" target="_blank" rel="noopener">GeoJSON</a> · <a href="${esc(shapefile)}" target="_blank" rel="noopener">Shapefile (.zip)</a></p>`;
}

const cards = catalog.layers.map((l) => {
  const vintage = vintageLine(l);
  return `
  <article class="card" data-src="${l.source}" data-search="${esc(`${l.typeName} ${l.title} ${l.abstract} ${l.keywords.join(' ')}`.toLowerCase())}">
    <h3>${esc(l.title)}</h3>
    <code>${esc(l.typeName)}</code>
    ${l.abstract ? `<p>${esc(l.abstract)}</p>` : '<p class="dim">Sin descripcion publicada.</p>'}
    <p class="meta-line">Publica: ${esc(SOURCE_LABEL[l.source] ?? l.source)}</p>
    <p class="meta-line">${esc(vintage)}</p>
    <p class="meta-line">Catálogo verificado: ${esc(l.verifiedAt)}</p>
    ${downloadLine(l)}
    <footer>
      <span class="src src-${l.source}">${esc(SOURCE_LABEL[l.source] ?? l.source)}</span>
    <span class="crs">${esc(l.defaultCrs.replace(/^urn:(x-)?ogc:def:crs:EPSG::?(\d+).*$/, 'EPSG:$2'))}</span>
    </footer>
    <div class="endpoint">${esc(l.endpoint)}</div>
  </article>`;
}).join('\n');

const LICENSES = `
  <section class="licenses">
    <h2>Licencias y atribución por fuente</h2>
    <p>Que un servicio sea público no garantiza reutilización. Lo siguiente son los términos publicados por cada organismo a nivel sitio/servicio, no licencias por capa; revisá el enlace antes de redistribuir:</p>
    <ul>
      <li><span class="src src-geosplan">${esc(SOURCE_LABEL.geosplan)}</span> Términos publicados del sitio: <a href="http://geosplan.tucuman.gov.ar/index.php/institucional/terminos-de-uso/">"La Secretaría de Estado de Gestión Pública y Planeamiento promueve el acceso y reutilización de la información publicada en este sitio web. Comparte la información en los términos que establece las licencias Creative Commons: Reconocimiento-No comercial-Compartir Igual"</a>, con criterios: "Que el contenido de la información no sea alterado", "Que no se desnaturalice el sentido de la información", "Que se cite la fuente", "Que se mencione la fecha de la última actualización", "Que no se persigan fines comerciales con la obra original o la utilización de la información publicada".</li>
      <li><span class="src src-ign">${esc(SOURCE_LABEL.ign)}</span> Términos publicados del organismo para "información descargada del sitio web del IGN": <a href="https://www.ign.gob.ar/descargas/tyc1.html">"Debe reconocerse la autoría del Instituto Geográfico Nacional de la República Argentina. Se debe compartir de manera libre y gratuita. Se permite su uso comercial únicamente en el caso de obras derivadas en que la información sea utilizada como insumo para generar un nuevo producto. El IGN no se responsabiliza por las consecuencias de la utilización de la información descargada."</a></li>
      <li><span class="src src-dgct">${esc(SOURCE_LABEL.dgct)}</span> Términos publicados del organismo: <a href="https://catastrotucuman.gov.ar/gestiones/servicio-wms-wfs/">no se publica licencia ni términos de uso; el servicio está documentado como experimental desde 2012</a>.</li>
    </ul>
    <p>Geocodificación: términos publicados del <a href="https://www.argentina.gob.ar/georef/condiciones-de-uso-y-licencia">Servicio Georef</a>: "Atribución obligatoria: se debe mencionar la fuente como 'Servicio Georef – argentina.gob.ar/georef' o incluir un enlace al sitio oficial. Indicación de modificaciones: si se redistribuye la información con cambios, debe indicarse que ha sido modificada. Uso responsable."</p>
    <p>El GetCapabilities de cada servicio no publica licencia por capa: la licencia de cada capa concreta queda sin verificar.</p>
  </section>`;

const CATALOG_CSS = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #f4f7f9; color: #1c2530; }
  header { background: #0d3b4f; color: #fff; padding: 28px 20px 20px; }
  header h1 { margin: 0 0 4px; font-size: 24px; }
  header p { margin: 0; opacity: .85; font-size: 14px; }
  .topnav { margin: 0 0 8px !important; }
  .topnav a { color: #fff; opacity: .9; font-size: 13px; }
  .backlink { display: inline-block; margin: 12px 16px 0; font-size: 13px; color: #0d6e8c; text-decoration: none; }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 0 16px 40px; }
  .controls { position: sticky; top: 0; background: #f4f7f9; padding: 14px 0 10px; z-index: 2; }
  #q { width: 100%; font-size: 16px; padding: 12px 14px; border: 1.5px solid #b9c8d2; border-radius: 10px; }
  .filters { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .filters button { font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 1.5px solid #0d6e8c; background: #fff; color: #0d6e8c; cursor: pointer; }
  .filters button.on { background: #0d6e8c; color: #fff; }
  #count { font-size: 13px; color: #5a6a76; margin-top: 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; margin-top: 8px; }
  .card { background: #fff; border: 1px solid #dbe4ea; border-radius: 12px; padding: 14px 16px; }
  .card h3 { margin: 0 0 6px; font-size: 16px; }
  .card code { font-size: 12px; background: #eef3f6; padding: 2px 6px; border-radius: 6px; word-break: break-all; }
  .card p { font-size: 13.5px; color: #40505c; margin: 8px 0; }
  .card .dim { color: #94a3ad; font-style: italic; }
  .card .meta-line { font-size: 12px; color: #5a6a76; margin: 4px 0 0; }
  .card .downloads { font-size: 12px; color: #5a6a76; margin: 6px 0 0; }
  .card .downloads a { color: #0d6e8c; }
  .hint { font-size: 12.5px; color: #5a6a76; margin-top: 8px; }
  .scope { font-size: 12.5px; color: #40505c; margin-top: 8px; line-height: 1.5; }
  .card footer { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; margin-top: 8px; }
  .src { font-size: 11.5px; font-weight: 600; padding: 3px 8px; border-radius: 999px; }
  .src-geosplan { background: #e3f2e9; color: #1c6b41; }
  .src-dgct { background: #fdeeda; color: #93550f; }
  .src-ign { background: #e2ecfb; color: #1d4e9e; }
  .crs { font-size: 11.5px; color: #7c8a96; }
  .endpoint { font-size: 11px; color: #94a3ad; margin-top: 6px; word-break: break-all; }
  .meta { font-size: 12.5px; color: #5a6a76; margin: 18px 0 0; }
  .licenses { margin-top: 28px; background: #fff; border: 1px solid #dbe4ea; border-radius: 12px; padding: 16px 18px; }
  .licenses h2 { font-size: 16px; margin: 0 0 8px; }
  .licenses p, .licenses li { font-size: 13px; color: #40505c; line-height: 1.5; }
  .licenses ul { margin: 8px 0; padding-left: 18px; }
  .licenses li { margin: 6px 0; }
  .licenses a { color: #0d6e8c; }`;

const catalogHtml = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoTucuman - Catalogo de capas geográficas públicas</title>
<style>${CATALOG_CSS}
</style>
</head>
<body>
<a class="backlink" href="./index.html">← Volver a la portada</a>
<header>
  <p class="topnav"><a href="./index.html">Ver portada</a></p>
  <h1>GeoTucuman</h1>
  <p>Catalogo de capas geográficas públicas: Tucumán primero. Se regenera con npm run catalog.<br>${freshness}</p>
</header>
<div class="wrap">
  <div class="controls">
    <input id="q" type="search" placeholder="Buscar por tema o palabra: &quot;agua&quot;, &quot;cultivos&quot;, &quot;calles&quot;...">
    <div class="filters">
      <button data-f="" class="on">Todas</button>
      <button data-f="geosplan">Planeamiento</button>
      <button data-f="dgct">Catastro</button>
      <button data-f="ign">IGN</button>
    </div>
    <div class="hint">Probá por intención: &quot;quiero hacer un mapa sobre agua&quot; tambien funciona (sin las comillas).</div>
    <div class="hint">La descarga trae la capa completa; algunas capas son grandes.</div>
    <p class="scope">GeoTucumán descubre y sugiere datasets: cuáles existen, quién los publica, de cuándo son y cómo descargarlos. No arma mapas ni análisis: eso lo hacés vos con el dataset. Ojo: una capa muestra lo que contiene — las parcelas catastrales no dicen cuántas personas viven ahí; para población buscá capas censales.</p>
    <div id="count"></div>
  </div>
  <div class="grid" id="grid">${cards}
  </div>${LICENSES}
  <p class="meta">Catalogo generado el ${esc(catalog.generatedAt.slice(0, 10))}. ${catalog.layers.length} capas.</p>
</div>
<script>
const TOPICS = {
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
const q = document.getElementById('q');
const initialQ = new URLSearchParams(location.search).get('q');
if (initialQ) q.value = initialQ;
const cards = [...document.querySelectorAll('.card')];
let filter = '';
function apply() {
  const raw = norm(q.value).split(/\\s+/).filter(Boolean);
  const terms = raw.filter(t => !STOPWORDS.has(t));
  let n = 0;
  for (const c of cards) {
    const hay = norm(c.dataset.search);
    const okQ = terms.every(t => variantsFor(t).some(v => hay.includes(v)));
    const okF = !filter || c.dataset.src === filter;
    c.style.display = okQ && okF ? '' : 'none';
    if (okQ && okF) n++;
  }
  document.getElementById('count').textContent = n + ' capas';
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

const LANDING_CSS = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #f4f7f9; color: #1c2530; line-height: 1.5; }
  a { color: #0d6e8c; }
  code { font-size: 12.5px; background: #eef3f6; padding: 1px 5px; border-radius: 6px; word-break: break-word; }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 0 16px; }
  header.hero { background: #0d3b4f; color: #fff; padding: 40px 16px 32px; }
  .hero h1 { margin: 0 0 8px; font-size: 32px; }
  .hero .tagline { margin: 0 0 20px; font-size: 16px; opacity: .9; max-width: 720px; }
  .hero-links { margin: 0; display: flex; gap: 10px; flex-wrap: wrap; }
  .btn { display: inline-block; background: #0d6e8c; color: #fff; text-decoration: none; padding: 10px 16px; border-radius: 10px; font-size: 14px; border: 1.5px solid #0d6e8c; }
  .btn-ghost { background: transparent; color: #fff; border-color: rgba(255,255,255,.6); }
  section { background: #fff; border: 1px solid #dbe4ea; border-radius: 12px; padding: 18px 20px; margin: 18px 0; }
  section > h2 { font-size: 18px; margin: 0 0 12px; color: #0d3b4f; }
  section p, section li { font-size: 14px; color: #40505c; }
  ul.tick { margin: 0; padding-left: 18px; }
  ul.tick li { margin: 6px 0; }
  table.tools { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13.5px; }
  table.tools th, table.tools td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e6edf2; vertical-align: top; }
  table.tools th { color: #5a6a76; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .demo { border: 1px solid #dbe4ea; border-radius: 10px; padding: 14px 16px; margin: 12px 0; background: #fbfdfe; }
  .demo h3 { margin: 0 0 10px; font-size: 15px; }
  .demo .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .demo input[type=text], .demo select { font-size: 14px; padding: 9px 11px; border: 1.5px solid #b9c8d2; border-radius: 8px; background: #fff; }
  .demo input[type=text] { flex: 1 1 260px; }
  .demo button { font-size: 14px; padding: 9px 16px; border-radius: 8px; border: 1.5px solid #0d6e8c; background: #0d6e8c; color: #fff; cursor: pointer; }
  .demo button:disabled { opacity: .6; cursor: default; }
  .demo pre { background: #0d3b4f; color: #e8f1f5; padding: 12px 14px; border-radius: 8px; overflow: auto; font-size: 12px; line-height: 1.45; max-height: 360px; }
  .demo .dim { color: #94a3ad; font-style: italic; }
  .demo .err { color: #a01b1b; background: #fdecec; border: 1px solid #f3c4c4; border-radius: 8px; padding: 8px 10px; }
  .demo .attr { font-size: 12px; color: #7c8a96; margin: 8px 0 0; }
  .demo .out { margin-top: 12px; }
  .demo .out ul { margin: 6px 0; padding-left: 18px; font-size: 13px; }
  .note { background: #fdf6e8; border-color: #f0dfb8; }
  .note p { margin: 6px 0; }
  pre.snippet { background: #0d3b4f; color: #e8f1f5; padding: 12px 14px; border-radius: 8px; overflow: auto; font-size: 12.5px; line-height: 1.5; }
  .src { font-size: 11.5px; font-weight: 600; padding: 3px 8px; border-radius: 999px; }
  .src-geosplan { background: #e3f2e9; color: #1c6b41; }
  .src-dgct { background: #fdeeda; color: #93550f; }
  .src-ign { background: #e2ecfb; color: #1d4e9e; }
  .src-georef { background: #eae6f8; color: #4a3a91; }
  ul.sources { margin: 0; padding-left: 18px; }
  ul.sources li { margin: 10px 0; }
  .dim { color: #94a3ad; }
  .licenses p, .licenses li { font-size: 13px; color: #40505c; line-height: 1.5; }
  .licenses ul { margin: 8px 0; padding-left: 18px; }
  .licenses li { margin: 6px 0; }
  footer.site { font-size: 12.5px; color: #5a6a76; margin: 24px 0 40px; }`;

const landingHtml = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoTucumán - MCP de descubrimiento y consulta de geodatos públicos</title>
<style>${LANDING_CSS}
</style>
</head>
<body>
<header class="hero">
  <div class="wrap">
    <h1>GeoTucumán</h1>
    <p class="tagline">MCP (Model Context Protocol) de descubrimiento y consulta de geodatos públicos, empezando por Tucumán, Argentina.</p>
    <p class="hero-links">
      <a class="btn" href="./capas.html">Ver catálogo de capas</a>
      <a class="btn btn-ghost" href="${REPO}">Repositorio en GitHub</a>
    </p>
  </div>
</header>
<div class="wrap">
  <section>
    <h2>Qué es</h2>
    <ul class="tick">
      <li><strong>Es</strong> una capa de descubrimiento y consulta sobre servicios WFS oficiales y la API Georef.</li>
      <li>Descubre y sugiere datasets públicos descargables según lo que necesités (con metadata: quién publica, de cuándo es el dato, cómo descargar). No arma el mapa ni el análisis por vos.</li>
      <li>Corre local por stdio con tu cliente MCP (por ejemplo Claude Code).</li>
      <li><strong>No es</strong> un SIG completo, ni un visor, ni una copia de los datos: consulta en vivo y cita la fuente.</li>
    </ul>
    <table class="tools">
      <thead><tr><th>Tool</th><th>Qué hace</th></tr></thead>
      <tbody>
        <tr><td><code>buscar_capas</code></td><td>Busca capas por palabra clave en el catálogo embebido</td></tr>
        <tr><td><code>describir_capa</code></td><td>Campos reales de una capa (obligatorio antes de consultar)</td></tr>
        <tr><td><code>consultar_capa</code></td><td>GetFeature con filtros, paginación y bbox en EPSG:4326 (se reproyecta al CRS nativo de la capa en el cliente)</td></tr>
        <tr><td><code>geocodificar</code></td><td>Texto libre a coordenadas vía API Georef (gratis, sin key)</td></tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>Probá que funciona</h2>
    <div class="demo">
      <h3>1. Descubrir datasets por intención</h3>
      <p>El corazón de GeoTucumán: decir qué necesitás en palabras comunes y encontrar el dataset.</p>
      <div class="row">
        <a class="btn" href="./capas.html?q=quiero%20hacer%20un%20mapa%20sobre%20agua">“quiero hacer un mapa sobre agua” →</a>
        <a class="btn" href="./capas.html?q=cultivos%20de%20soja">“cultivos de soja” →</a>
        <a class="btn" href="./capas.html?q=radios%20censales">“radios censales” →</a>
      </div>
    </div>
    <div class="demo">
      <h3>2. Geocodificar (Georef, en vivo)</h3>
      <div class="row">
        <input id="geo-input" type="text" value="25 de Mayo y Marcos Paz">
        <button id="geo-btn" type="button">Geocodificar</button>
      </div>
      <div id="geo-out" class="out"><p class="dim">Escribí una dirección y tocá Geocodificar.</p></div>
    </div>
    <div class="demo">
      <h3>3. Consultar capa (WFS del IGN, en vivo)</h3>
      <div class="row">
        <select id="wfs-select">
          <option value="ign:area_protegida">Área protegida</option>
          <option value="ign:puntos_de_transporte_aereo_GB001">Aeródromo</option>
          <option value="ign:lineas_de_aguas_continentales_perenne">Corriente de agua perenne</option>
        </select>
        <button id="wfs-btn" type="button">Consultar en vivo</button>
      </div>
      <div id="wfs-out" class="out"><p class="dim">Elegí una capa y tocá Consultar en vivo.</p></div>
    </div>
    <div class="demo note">
      <h3>4. Geosplan y Catastro (DGCT): capturas reales</h3>
      <p>Geosplan y Catastro (DGCT) sirven por HTTP plano, así que el navegador bloquea consultas en vivo desde esta página HTTPS (contenido mixto). En su lugar se muestran respuestas reales registradas el ${CAPTURE_DATE}:</p>
      <p><strong>${esc(SOURCE_ORG.geosplan)}</strong><br><code>${esc(SOURCE_ENDPOINT.geosplan)}</code><br>capa <code>WFS_GEOSPLAN:aeropuerto</code> · capturado ${CAPTURE_DATE}</p>
      <pre>${geosplanDemoHtml}</pre>
      <p><strong>${esc(SOURCE_ORG.dgct)}</strong><br><code>${esc(SOURCE_ENDPOINT.dgct)}</code><br>capa <code>dgct:SECCIONES</code> · capturado ${CAPTURE_DATE}</p>
      <pre>${dgctDemoHtml}</pre>
    </div>
  </section>

  <section>
    <h2>Qué hay atrás</h2>
    <ul class="tick">
      <li>Servidor MCP por stdio con <code>@modelcontextprotocol/sdk</code>, escrito en TypeScript estricto y validación con <code>zod</code>.</li>
      <li>Catálogo embebido generado desde los <code>GetCapabilities</code> en vivo (<code>npm run catalog</code>), con estado por fuente: <em>live</em> o snapshot preservado si el endpoint cae.</li>
      <li>El bbox se consulta en EPSG:4326 y el servidor lo reproyecta al CRS nativo de cada capa; reproyección Gauss-Krüger/TM propia para EPSG:22183 y EPSG:5345 verificada contra proj4 con error &lt; 0.001 m.</li>
    </ul>
    <p>Quickstart:</p>
    <pre class="snippet">npm install
npm run catalog
npm run smoke
npm run portal
npm run build &amp;&amp; npm start</pre>
    <p>Config de cliente MCP (ej. Claude Code):</p>
    <pre class="snippet">${esc('{ "mcpServers": { "geotucuman": { "command": "node", "args": ["/ruta/geotucuman/dist/server.js"] } } }')}</pre>
  </section>

  <section>
    <h2>Fuentes</h2>
    <ul class="sources">
      <li><span class="src src-geosplan">Geosplan</span> ${esc(SOURCE_ORG.geosplan)}<br><code>${esc(SOURCE_ENDPOINT.geosplan)}</code><br><span class="dim">${esc(freshnessStatus('geosplan'))}</span></li>
      <li><span class="src src-dgct">Catastro (DGCT)</span> ${esc(SOURCE_ORG.dgct)}<br><code>${esc(SOURCE_ENDPOINT.dgct)}</code><br><span class="dim">${esc(freshnessStatus('dgct'))}</span><br><span class="dim">Documentado como experimental desde 2012; el endpoint es intermitente (cayó y volvió el ${CAPTURE_DATE}).</span></li>
      <li><span class="src src-ign">IGN</span> ${esc(SOURCE_ORG.ign)}<br><code>${esc(SOURCE_ENDPOINT.ign)}</code><br><span class="dim">${esc(freshnessStatus('ign'))}</span></li>
      <li><span class="src src-georef">Georef</span> Geocodificación (API Georef)<br><code>https://apis.datos.gob.ar/georef/api/</code></li>
    </ul>
    <p class="dim">Cobertura: hoy 3 servicios WFS + la API Georef. No es exhaustivo: hay más datasets públicos dispersos. Pendientes conocidos: RIDES (Producción, Tucumán: <a href="https://rides.producciontucuman.gob.ar/">https://rides.producciontucuman.gob.ar/</a>), el portal de Datos Abiertos de Tucumán (<a href="https://datos.tucuman.gob.ar/">https://datos.tucuman.gob.ar/</a>) y el enriquecimiento con metadatos IDERA.</p>
  </section>

  <section>
    <h2>Capas</h2>
    <p>${esc(capasLine)}. El catálogo completo se puede buscar y filtrar en <a href="./capas.html">capas.html</a>.</p>
  </section>

  ${LICENSES.trim()}

  <footer class="site">
    Código MIT. Los datos son de sus organismos publicadores. Generado el ${esc(catalog.generatedAt.slice(0, 10))}. <a href="${REPO}">Repositorio en GitHub</a>.
  </footer>
</div>
<script>
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
console.log(`docs/index.html generado (miniweb) y docs/capas.html generado (${catalog.layers.length} capas)`);
