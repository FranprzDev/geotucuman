/**
 * Builds docs/ejemplos/focos-tucuman.html from the result produced by
 * examples/focos-tucuman.ts. Static page, no build system: Leaflet 1.9.x is
 * loaded from the unpkg CDN, everything else is inlined.
 *
 * The page is data-driven: it embeds the computed focos and summary so the
 * map, the panel and the provenance note always match the last run.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export type Sensor = 'VIIRS' | 'MODIS';

export interface FocoResult {
  sensor: Sensor;
  instrument: string;
  satellite: string;
  date: string | null;
  time: string | null;
  lon: number;
  lat: number;
  confidence: number | null;
  distanceToNearestPozoKm: number | null;
  nearestPozoName: string | null;
  distanceToNearestWaterKm: number | null;
  nearestWaterName: string | null;
  nearestWaterKind: string | null;
  insideCuenca: boolean;
  cuencaName: string | null;
}

export interface Distribution {
  min: number | null;
  median: number | null;
  max: number | null;
}

export interface Summary {
  totalFocos: number;
  perSensor: { VIIRS: number; MODIS: number };
  insideCuenca: number;
  insideCuencaPct: number;
  distanceToNearestPozoKm: Distribution;
  distanceToNearestWaterKm: Distribution;
  rides: {
    pozos: number;
    canales: number;
    rios: number;
    cuerpos: number;
    cuencas: number;
  };
}

export interface SourceProvenance {
  id: string;
  label: string;
  kind: 'live' | 'fixture';
  url: string;
  fetchedAt: string | null;
  dataDate: string | null;
  features: number;
  note?: string;
}

export interface ExampleResult {
  generatedAt: string;
  bbox: [number, number, number, number];
  provenance: SourceProvenance[];
  focos: FocoResult[];
  summary: Summary;
}

const REPO = 'https://github.com/FranprzDev/geotucuman';
const CONAE_CATALOG = 'https://catalogos.conae.gov.ar/catalogo/catalogoGeoServiciosOGC.html';
const RIDES_WMS =
  'https://gis.producciontucuman.gob.ar/ArcGIS/services/Recursos_Hidricos_WMS/MapServer/WMSServer';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtKm = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)} km`);
const fmtPct = (v: number): string => `${v.toFixed(v % 1 === 0 ? 0 : 1)}%`;

/** Shared visual system, aligned with docs/salud.html and docs/capas.html. */
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
  a:focus-visible, button:focus-visible { outline: 2px solid var(--brand-bright); outline-offset: 3px; border-radius: 8px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; background: rgba(63,214,234,.09); color: var(--brand-bright); border: 1px solid rgba(63,214,234,.16); padding: 1px 6px; border-radius: 6px; word-break: break-word; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; width: 100%; }
  .skip { position: absolute; left: 16px; top: -64px; z-index: 100; background: var(--brand); color: #041016; padding: 10px 14px; border-radius: 10px; font-weight: 700; text-decoration: none; }
  .skip:focus { top: 12px; }
  .site-header { position: sticky; top: 0; z-index: 1000; background: rgba(5,7,12,.68); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); }
  .header-inner { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: var(--header-h); }
  .brand { display: inline-flex; align-items: center; gap: 9px; color: var(--ink); text-decoration: none; font-size: 18px; font-weight: 750; letter-spacing: -.025em; }
  .brand:hover { color: var(--ink); }
  .brand svg { width: 22px; height: 22px; color: var(--brand); filter: drop-shadow(0 0 10px rgba(63,214,234,.55)); }
  .nav { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .nav a { color: var(--muted); text-decoration: none; font-size: 13.5px; font-weight: 600; padding: 8px 11px; border-radius: 999px; }
  .nav a:hover { color: var(--ink); background: rgba(255,255,255,.05); }
  .nav a[aria-current="page"] { color: var(--brand-bright); }
  .nav a.nav-cta { color: #04141a; background: var(--brand); font-weight: 600; margin-left: 6px; }
  .nav a.nav-cta:hover { background: var(--brand-bright); color: #04141a; }
  .panel { background: linear-gradient(180deg, rgba(20,24,36,.94), rgba(13,15,24,.94)); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: clamp(20px, 4vw, 32px); margin: 20px 0; }
  .panel h2 { font-size: clamp(20px, 2.6vw, 26px); line-height: 1.15; letter-spacing: -.025em; font-weight: 750; color: var(--ink); margin: 0 0 14px; }
  .panel p, .panel li { font-size: 14.5px; color: #a6b4c0; }
  .panel ul { margin: 10px 0; padding-left: 20px; }
  .eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--brand); font-weight: 700; margin: 0 0 10px; }
  .dim { color: var(--muted-2); }
  footer.site { font-size: 12.5px; color: var(--muted); margin: 28px 0 54px; padding-top: 20px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 10px 18px; flex-wrap: wrap; }
  footer.site .made { color: var(--muted-2); }
  h1, h2, h3, .brand { font-family: "Space Grotesk", "Inter", ui-sans-serif, sans-serif; letter-spacing: -.02em; }
  @media (max-width: 520px) { .nav a { padding: 8px 7px; font-size: 12.5px; } .brand { font-size: 16px; } .wrap { padding: 0 16px; } }`;

const PAGE_CSS = `
  .hero-slim { position: relative; overflow: hidden; padding: clamp(34px, 6vw, 58px) 20px clamp(30px, 5vw, 48px); border-bottom: 1px solid var(--line); }
  .hero-slim::before { content: ""; position: absolute; inset: -40% -10% auto; height: 150%; background: radial-gradient(ellipse at 50% 0%, rgba(63,214,234,.2), transparent 64%); pointer-events: none; }
  .hero-slim .wrap { position: relative; }
  .hero-slim h1 { font-size: clamp(28px, 4.4vw, 44px); line-height: 1.08; letter-spacing: -.035em; margin: 0 0 8px; color: var(--ink); }
  .hero-slim p { margin: 0; font-size: 14.5px; color: var(--muted); max-width: 800px; }
  .cards { display: grid; grid-template-columns: minmax(0,1fr); gap: 14px; margin: 22px 0 6px; }
  @media (min-width: 720px) { .cards { grid-template-columns: repeat(4, 1fr); } }
  .stat { background: linear-gradient(180deg, rgba(22,26,39,.96), rgba(15,18,28,.97)); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 10px 30px rgba(0,0,0,.3); padding: 16px 18px; }
  .stat .k { font-size: 11.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin: 0 0 8px; }
  .stat .v { font-family: "Space Grotesk", "Inter", sans-serif; font-size: clamp(24px, 3.4vw, 30px); font-weight: 700; letter-spacing: -.03em; color: var(--ink); line-height: 1.1; }
  .stat .v small { font-size: 14px; color: var(--muted); font-weight: 600; }
  .map-grid { display: grid; grid-template-columns: minmax(0,1fr); gap: 16px; margin: 22px 0; }
  @media (min-width: 900px) { .map-grid { grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr); align-items: start; } }
  #map { height: clamp(380px, 58vh, 560px); width: 100%; border-radius: var(--radius); border: 1px solid var(--line); background: var(--surface); z-index: 1; }
  .aside { display: flex; flex-direction: column; gap: 14px; }
  .readout { background: linear-gradient(180deg, rgba(22,26,39,.96), rgba(15,18,28,.97)); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; }
  .readout h3 { margin: 0 0 10px; font-size: 15px; letter-spacing: -.01em; }
  .readout dl { margin: 0; display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; font-size: 13.5px; }
  .readout dt { color: var(--muted); }
  .readout dd { margin: 0; font-weight: 650; color: var(--ink); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
  .legend { display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 8px; }
  .swatch { width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(0,0,0,.35); }
  .wmsbox { width: 22px; height: 12px; border-radius: 3px; background: linear-gradient(90deg, rgba(63,214,234,.75), rgba(63,214,234,.1)); border: 1px solid rgba(63,214,234,.5); }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: rgba(11,16,26,.6); }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 700; background: rgba(16,22,35,.9); }
  tbody tr:hover { background: rgba(255,255,255,.025); }
  tbody tr:last-child td { border-bottom: 0; }
  td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--muted); white-space: nowrap; }
  .prov { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .prov li { font-size: 13px; color: var(--muted); border-left: 2px solid var(--line-strong); padding-left: 10px; }
  .prov li b { color: var(--ink); font-weight: 650; }
  .pill { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 1px 7px; border-radius: 999px; border: 1px solid; }
  .pill-live { color: #6ee7b7; border-color: rgba(52,211,153,.5); background: rgba(52,211,153,.1); }
  .pill-fixture { color: #fcd34d; border-color: rgba(245,168,60,.5); background: rgba(245,168,60,.12); }
  .leaflet-popup-content { font-size: 12.5px; line-height: 1.5; }
  .leaflet-popup-content b { color: #0b101a; }
  .leaflet-container { background: #0b101a; }`;

const header = `<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="../index.html" aria-label="GeoArg, inicio">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/></svg>
      <span>GeoArg</span>
    </a>
    <nav class="nav" aria-label="Principal">
      <a href="../capas.html">Capas</a>
      <a href="../salud.html">Salud de capas</a>
      <a href="./focos-tucuman.html" aria-current="page">Ejemplo: focos</a>
      <a class="nav-cta" href="${REPO}">GitHub</a>
    </nav>
  </div>
</header>`;

const footer = `<footer class="site">
      <span>Código MIT · Los datos son de sus organismos publicadores (CONAE, RIDES) · <a href="${REPO}">Repositorio en GitHub</a></span>
      <span class="made">Hecho por FranPrzDev</span>
    </footer>`;

function provenanceItems(result: ExampleResult): string {
  return result.provenance
    .map((p) => {
      const pill = p.kind === 'live'
        ? '<span class="pill pill-live">en vivo</span>'
        : '<span class="pill pill-fixture">fixture</span>';
      const date = p.dataDate ? ` · dato ${esc(p.dataDate)}` : '';
      const note = p.note ? ` — ${esc(p.note)}` : '';
      return `<li><b>${esc(p.label)}</b> ${pill} · ${p.features} registros${date}${note}</li>`;
    })
    .join('\n');
}

function focosTable(result: ExampleResult): string {
  return result.focos
    .map((f) => {
      const when = [f.date, f.time].filter(Boolean).join(' ') || '—';
      const cuenca = f.insideCuenca ? (f.cuencaName ?? 'Sí') : 'No';
      return `<tr>
        <td><span class="swatch" style="display:inline-block;background:${f.sensor === 'VIIRS' ? '#f87171' : '#f5a83c'};margin-right:6px"></span>${esc(f.sensor)}</td>
        <td class="mono">${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}</td>
        <td class="mono">${esc(when)}</td>
        <td>${esc(f.satellite)}</td>
        <td class="mono">${f.confidence ?? '—'}</td>
        <td class="mono">${fmtKm(f.distanceToNearestPozoKm)}</td>
        <td class="mono">${fmtKm(f.distanceToNearestWaterKm)}</td>
        <td>${esc(cuenca)}</td>
      </tr>`;
    })
    .join('\n');
}

function buildBody(result: ExampleResult): string {
  const s = result.summary;
  const generated = result.generatedAt.replace('T', ' ').slice(0, 16) + ' UTC';
  const focosJson = JSON.stringify(result.focos).replace(/</g, '\\u003c');

  return `<section class="hero-slim" aria-labelledby="focos-title">
  <div class="wrap">
    <p class="eyebrow">Ejemplo aplicado</p>
    <h1 id="focos-title">Focos de calor vs agua en Tucumán</h1>
    <p>Cruza los focos de calor de las últimas 24&nbsp;h (CONAE, satélites VIIRS/MODIS) con la infraestructura hídrica de Tucumán (RIDES): distancia al pozo de agua y al cuerpo/curso de agua más cercanos, y si el foco cae dentro de una cuenca hídrica. Análisis generado el ${esc(generated)}.</p>
  </div>
</section>
<main id="main" class="wrap">
  <div class="cards">
    <div class="stat"><p class="k">Focos (24 h)</p><p class="v">${s.totalFocos}</p></div>
    <div class="stat"><p class="k">VIIRS / MODIS</p><p class="v">${s.perSensor.VIIRS} <small>/ ${s.perSensor.MODIS}</small></p></div>
    <div class="stat"><p class="k">Dentro de cuenca</p><p class="v">${fmtPct(s.insideCuencaPct)} <small>${s.insideCuenca}/${s.totalFocos}</small></p></div>
    <div class="stat"><p class="k">Pozo más cercano</p><p class="v">${fmtKm(s.distanceToNearestPozoKm.min)}</p></div>
  </div>

  <div class="map-grid">
    <div id="map" role="application" aria-label="Mapa de focos de calor y capas hídricas de Tucumán"></div>
    <div class="aside">
      <div class="readout">
        <h3>Resumen medido</h3>
        <dl>
          <dt>Focos totales</dt><dd>${s.totalFocos}</dd>
          <dt>Dentro de cuenca</dt><dd>${s.insideCuenca} (${fmtPct(s.insideCuencaPct)})</dd>
        </dl>
      </div>
      <div class="readout">
        <h3>Distancia a pozo de agua</h3>
        <dl>
          <dt>Mínima</dt><dd>${fmtKm(s.distanceToNearestPozoKm.min)}</dd>
          <dt>Mediana</dt><dd>${fmtKm(s.distanceToNearestPozoKm.median)}</dd>
          <dt>Máxima</dt><dd>${fmtKm(s.distanceToNearestPozoKm.max)}</dd>
        </dl>
      </div>
      <div class="readout">
        <h3>Distancia a agua</h3>
        <dl>
          <dt>Mínima</dt><dd>${fmtKm(s.distanceToNearestWaterKm.min)}</dd>
          <dt>Mediana</dt><dd>${fmtKm(s.distanceToNearestWaterKm.median)}</dd>
          <dt>Máxima</dt><dd>${fmtKm(s.distanceToNearestWaterKm.max)}</dd>
        </dl>
        <p class="dim" style="font-size:11.5px;margin:10px 0 0">Cuerpos, ríos y canales combinados (${s.rides.cuerpos + s.rides.rios + s.rides.canales} geometrías).</p>
      </div>
      <div class="readout">
        <h3>Leyenda</h3>
        <div class="legend">
          <span><span class="swatch" style="background:#f87171"></span>Foco VIIRS</span>
          <span><span class="swatch" style="background:#f5a83c"></span>Foco MODIS</span>
          <span><span class="wmsbox"></span>Pozos de agua y cuencas (WMS RIDES)</span>
        </div>
      </div>
    </div>
  </div>

  <section class="panel" aria-labelledby="tabla-title">
    <h2 id="tabla-title">Focos y su entorno</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Sensor</th><th>Coordenadas</th><th>Fecha/hora</th><th>Satélite</th><th>Conf.</th><th>Pozo</th><th>Agua</th><th>Cuenca</th></tr></thead>
        <tbody>
${focosTable(result)}
        </tbody>
      </table>
    </div>
    <p class="dim" style="font-size:12px;margin-top:10px">Distancias calculadas con haversine y distancia punto–segmento sobre las geometrías descargadas; el criterio de cuenca es punto-en-polígono (regla par-impar) sobre el polígono de la cuenca. ${s.rides.pozos} pozos y ${s.rides.cuencas} cuencas evaluados.</p>
  </section>

  <section class="panel" aria-labelledby="prov-title">
    <h2 id="prov-title">Procedencia de los datos</h2>
    <ul class="prov">
${provenanceItems(result)}
    </ul>
    <p style="margin-top:14px">Focos de calor: <a href="${CONAE_CATALOG}">CONAE — catálogo de GeoServicios OGC</a> (WFS nacional, capas <code>FocosDeCalorVIIRS</code> y <code>FocosDeCalor</code>). Infraestructura hídrica: Ministerio de Producción de Tucumán, <a href="https://rides.producciontucuman.gob.ar/servicios-wms/">RIDES</a>.</p>
    <p class="dim" style="font-size:12px">Las fechas son las publicadas por cada organismo. CONAE puede geo-bloquear accesos fuera de Argentina; cuando la consulta en vivo falla, el script usa los fixtures versionados en <code>examples/fixtures/</code> y lo indica arriba.</p>
  </section>

  <section class="panel" aria-labelledby="how-title">
    <h2 id="how-title">Cómo se hizo</h2>
    <p>Este ejemplo nace de <a href="${REPO}">GeoArg</a>, un MCP de descubrimiento y consulta de geodatos públicos. El MCP es el que <em>descubre</em> las capas: <code>search_layers</code> y <code>suggest_layers</code> ubican los focos de calor de CONAE y las capas hídricas de RIDES (en el catálogo, RIDES figura como WMS-only), y <code>describe_layer</code> muestra sus campos reales. Con eso a la vista, este caso consulta los servicios públicos directamente —WFS de CONAE y ArcGIS REST de RIDES— y calcula proximidades con TypeScript puro, sin dependencias: haversine, distancia punto–segmento y punto-en-polígono (incluye MultiPolygon).</p>
    <p>Reproducilo con <code>npm run example:focos</code>. El script escribe <code>examples/out/focos-tucuman-result.json</code> y esta página; el mismo resultado alimenta el mapa, la tabla y los números de arriba.</p>
  </section>
  ${footer}
</main>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const FOCOS = ${focosJson};
const COLORS = { VIIRS: '#f87171', MODIS: '#f5a83c' };
const map = L.map('map', { scrollWheelZoom: false });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);
L.tileLayer.wms('${RIDES_WMS}', {
  layers: 'Pozos_de_agua,Cuencas_hídricas',
  format: 'image/png',
  transparent: true,
  version: '1.1.1',
  opacity: 0.85,
  attribution: 'RIDES — Ministerio de Producción de Tucumán'
}).addTo(map);
const km = (v) => (v == null ? 's/d' : v.toFixed(1) + ' km');
const markers = [];
for (const f of FOCOS) {
  const m = L.circleMarker([f.lat, f.lon], {
    radius: 7, color: '#05070c', weight: 1.5, fillColor: COLORS[f.sensor] || '#3fd6ea', fillOpacity: 0.9
  }).addTo(map);
  const when = [f.date, f.time].filter(Boolean).join(' ') || 'sin fecha';
  const cuenca = f.insideCuenca ? ('Sí' + (f.cuencaName ? ' · ' + f.cuencaName : '')) : 'No';
  m.bindPopup(
    '<b>' + f.sensor + ' · ' + f.satellite + '</b><br>' +
    when + '<br>' +
    'Confianza: ' + (f.confidence == null ? 's/d' : f.confidence) + '<br>' +
    'Pozo más cercano: ' + km(f.distanceToNearestPozoKm) + (f.nearestPozoName ? (' (' + f.nearestPozoName + ')') : '') + '<br>' +
    'Agua más cercana: ' + km(f.distanceToNearestWaterKm) + (f.nearestWaterKind ? (' (' + f.nearestWaterKind + ')') : '') + '<br>' +
    'Dentro de cuenca: ' + cuenca
  );
  markers.push(m);
}
if (markers.length) {
  map.fitBounds(L.featureGroup(markers).getBounds().pad(0.25));
} else {
  map.setView([-26.8, -65.2], 8);
}
</script>`;
}

export function buildExamplePage(result: ExampleResult): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoArg — Focos de calor vs agua en Tucumán</title>
<meta name="description" content="Ejemplo aplicado de GeoArg: focos de calor de CONAE (VIIRS/MODIS) cruzados con pozos, cursos de agua y cuencas de RIDES en Tucumán.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>${BASE_CSS}${PAGE_CSS}
</style>
</head>
<body>
<a class="skip" href="#main">Saltar al contenido</a>
${header}
${buildBody(result)}
</body>
</html>`;
}

const RESULT_PATH = 'examples/out/focos-tucuman-result.json';
const OUT_PATH = 'docs/ejemplos/focos-tucuman.html';

function main(): void {
  const result = JSON.parse(readFileSync(RESULT_PATH, 'utf-8')) as ExampleResult;
  mkdirSync('docs/ejemplos', { recursive: true });
  writeFileSync(OUT_PATH, buildExamplePage(result));
  console.log(`${OUT_PATH} generated (${result.focos.length} focos)`);
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) main();
