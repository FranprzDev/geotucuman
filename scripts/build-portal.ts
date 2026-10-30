/** Genera docs/index.html: portal estatico de descubrimiento de capas (sin dependencias externas). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Catalog } from '../src/catalog.js';

const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf-8')) as Catalog;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SOURCE_LABEL: Record<string, string> = {
  geosplan: 'Planeamiento (Geosplan) - Tucuman',
  dgct: 'Direccion General de Catastro - Tucuman',
  ign: 'Instituto Geografico Nacional - Argentina',
};

const LICENSE_NOTE: Record<string, string> = {
  geosplan: 'CC BY-NC-SA: citar fuente y fecha, sin uso comercial de la obra original',
  dgct: 'Sin licencia explicita publicada (servicio experimental): confirmar reuso antes de redistribuir',
  ign: 'Terminos IGN: atribucion obligatoria, compartir libre y gratuito; uso comercial solo en obras derivadas',
};

const cards = catalog.layers.map((l) => `
  <article class="card" data-src="${l.source}" data-search="${esc(`${l.typeName} ${l.title} ${l.abstract} ${l.keywords.join(' ')}`.toLowerCase())}">
    <h3>${esc(l.title)}</h3>
    <code>${esc(l.typeName)}</code>
    ${l.abstract ? `<p>${esc(l.abstract)}</p>` : '<p class="dim">Sin descripcion publicada.</p>'}
    <footer>
      <span class="src src-${l.source}">${esc(SOURCE_LABEL[l.source] ?? l.source)}</span>
    <span class="crs">${esc(l.defaultCrs.replace(/^urn:(x-)?ogc:def:crs:EPSG::?(\d+).*$/, 'EPSG:$2'))}</span>
    </footer>
    <div class="endpoint">${esc(l.endpoint)}</div>
  </article>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoTucuman - Catalogo de capas geográficas públicas</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #f4f7f9; color: #1c2530; }
  header { background: #0d3b4f; color: #fff; padding: 28px 20px 20px; }
  header h1 { margin: 0 0 4px; font-size: 24px; }
  header p { margin: 0; opacity: .85; font-size: 14px; }
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
  .card footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; }
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
  .licenses a { color: #0d6e8c; }
</style>
</head>
<body>
<header>
  <h1>GeoTucuman</h1>
  <p>Catalogo de capas geográficas públicas: Tucumán primero. Snapshot generado desde los GetCapabilities oficiales (se regenera con npm run catalog). · Actualizado el ${catalog.generatedAt.slice(0, 10)}</p>
</header>
<div class="wrap">
  <div class="controls">
    <input id="q" type="search" placeholder="Buscar capa... (ej: parcelas, calles, cultivos, radios censales)">
    <div class="filters">
      <button data-f="" class="on">Todas</button>
      <button data-f="geosplan">Planeamiento</button>
      <button data-f="dgct">Catastro</button>
      <button data-f="ign">IGN</button>
    </div>
    <div id="count"></div>
  </div>
  <div class="grid" id="grid">${cards}
  </div>
  <section class="licenses">
    <h2>Licencias y atribución por fuente</h2>
    <p>Que un servicio sea público no garantiza licencia de reutilización. Esto es lo que publica cada organismo (verificado el 2026-10-30); revisá el enlace antes de redistribuir:</p>
    <ul>
      <li><span class="src src-geosplan">${esc(SOURCE_LABEL.geosplan)}</span> ${esc(LICENSE_NOTE.geosplan)} — <a href="http://geosplan.tucuman.gov.ar/index.php/institucional/terminos-de-uso/">términos de uso</a></li>
      <li><span class="src src-dgct">${esc(SOURCE_LABEL.dgct)}</span> ${esc(LICENSE_NOTE.dgct)} — <a href="https://catastrotucuman.gov.ar/gestiones/servicio-wms-wfs/">servicio WMS/WFS</a></li>
      <li><span class="src src-ign">${esc(SOURCE_LABEL.ign)}</span> ${esc(LICENSE_NOTE.ign)} — <a href="https://www.ign.gob.ar/descargas/tyc1.html">términos y condiciones</a></li>
    </ul>
    <p>Geocodificación: <a href="https://www.argentina.gob.ar/georef/condiciones-de-uso-y-licencia">Servicio Georef</a> (atribución obligatoria: "Servicio Georef – argentina.gob.ar/georef").</p>
  </section>
  <p class="meta">Catalogo generado el ${esc(catalog.generatedAt.slice(0, 10))} desde GetCapabilities en vivo. ${catalog.layers.length} capas.</p>
</div>
<script>
const q = document.getElementById('q');
const cards = [...document.querySelectorAll('.card')];
let filter = '';
function apply() {
  const terms = q.value.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').split(/\\s+/).filter(Boolean);
  let n = 0;
  for (const c of cards) {
    const hay = c.dataset.search.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
    const okQ = terms.every(t => hay.includes(t));
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

mkdirSync('docs', { recursive: true });
writeFileSync('docs/index.html', html);
console.log(`docs/index.html generado (${catalog.layers.length} capas)`);
