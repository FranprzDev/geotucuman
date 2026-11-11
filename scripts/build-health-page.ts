/**
 * Generates docs/salud.html from data/health.json. Static page, no build system.
 * If the report is missing it still renders a page explaining that no check has run.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ENDPOINTS } from '../src/endpoints.js';

interface Outcome {
  ok: boolean;
  ms: number;
  detail: string;
}

interface LayerHealth {
  wms?: Outcome;
  wfs?: Outcome;
  arcgis?: Outcome;
}

interface SourceHealth {
  ok: number;
  total: number;
  avgMs: number;
  failedLayerIds: string[];
}

interface HealthReport {
  checkedAt: string;
  durationMs: number;
  totals: {
    layers: number;
    layersOk: number;
    layersFailed: number;
    probes: number;
    probesOk: number;
    avgMs: number;
  };
  sources: Record<string, SourceHealth>;
  layers: Record<string, LayerHealth>;
}

const REPO = 'https://github.com/FranprzDev/geotucuman';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const provinceOf = (id: string): string => ENDPOINTS.find((e) => e.id === id)?.province ?? id;
const labelOf = (id: string): string => ENDPOINTS.find((e) => e.id === id)?.label ?? id;

let health: HealthReport | null = null;
try {
  health = JSON.parse(readFileSync('data/health.json', 'utf-8')) as HealthReport;
} catch {
  health = null;
}

let titleById = new Map<string, string>();
try {
  const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf-8')) as {
    layers: Array<{ id: string; title: string }>;
  };
  titleById = new Map(catalog.layers.map((l) => [l.id, l.title]));
} catch {
  titleById = new Map();
}

/** Shared visual system, aligned with docs/capas.html. */
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
  .nav a.nav-cta { color: #04141a; background: var(--brand); font-weight: 600; margin-left: 6px; }
  .nav a.nav-cta:hover { background: var(--brand-bright); color: #04141a; }
  .panel { background: linear-gradient(180deg, rgba(20,24,36,.94), rgba(13,15,24,.94)); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: clamp(20px, 4vw, 36px); margin: 20px 0; }
  .panel > h2, .section-head h2 { font-size: clamp(22px, 3vw, 30px); line-height: 1.15; letter-spacing: -.025em; font-weight: 750; color: var(--ink); margin: 0 0 16px; }
  .panel p, .panel li { font-size: 14.5px; color: #a6b4c0; }
  .eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--brand); font-weight: 700; margin: 0 0 10px; }
  .dim { color: var(--muted-2); }
  .hint { font-size: 12.5px; color: var(--muted); margin-top: 8px; }
  footer.site { font-size: 12.5px; color: var(--muted); margin: 28px 0 54px; padding-top: 20px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 10px 18px; flex-wrap: wrap; }
  footer.site .made { color: var(--muted-2); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  h1, h2, h3, .brand { font-family: "Space Grotesk", "Inter", ui-sans-serif, sans-serif; letter-spacing: -.02em; }
  @media (max-width: 520px) { .nav a { padding: 8px 7px; font-size: 12.5px; } .brand { font-size: 16px; } .wrap { padding: 0 16px; } }`;

const HEALTH_CSS = `
  .hero-slim { position: relative; overflow: hidden; padding: clamp(34px, 6vw, 58px) 20px clamp(30px, 5vw, 48px); border-bottom: 1px solid var(--line); }
  .hero-slim::before { content: ""; position: absolute; inset: -40% -10% auto; height: 150%; background: radial-gradient(ellipse at 50% 0%, rgba(63,214,234,.2), transparent 64%); pointer-events: none; }
  .hero-slim .wrap { position: relative; }
  .hero-slim h1 { font-size: clamp(28px, 4.4vw, 44px); line-height: 1.08; letter-spacing: -.035em; margin: 0 0 8px; color: var(--ink); }
  .hero-slim p { margin: 0; font-size: 14.5px; color: var(--muted); max-width: 780px; }
  .cards { display: grid; grid-template-columns: minmax(0,1fr); gap: 14px; margin: 22px 0 6px; }
  @media (min-width: 720px) { .cards { grid-template-columns: repeat(3, 1fr); } }
  .stat { background: linear-gradient(180deg, rgba(22,26,39,.96), rgba(15,18,28,.97)); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 10px 30px rgba(0,0,0,.3); padding: 18px 20px; }
  .stat .k { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin: 0 0 8px; }
  .stat .v { font-family: "Space Grotesk", "Inter", sans-serif; font-size: clamp(26px, 4vw, 34px); font-weight: 700; letter-spacing: -.03em; color: var(--ink); line-height: 1.1; }
  .stat .v small { font-size: 15px; color: var(--muted); font-weight: 600; }
  .section-block { margin: 30px 0; }
  .section-block h2 { font-size: clamp(20px, 2.6vw, 26px); letter-spacing: -.025em; margin: 0 0 12px; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: rgba(11,16,26,.6); }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .09em; font-weight: 700; background: rgba(16,22,35,.9); position: sticky; top: var(--header-h); z-index: 5; }
  tbody tr:hover { background: rgba(255,255,255,.025); }
  tbody tr:last-child td { border-bottom: 0; }
  td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--muted); white-space: nowrap; }
  td.detail { max-width: 340px; font-size: 12px; color: var(--muted-2); }
  .layer-title { font-weight: 600; color: var(--ink); }
  code.typename { font-size: 11.5px; word-break: break-all; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .dot-ok { background: #34d399; box-shadow: 0 0 8px rgba(52,211,153,.6); }
  .dot-warn { background: #f5a83c; box-shadow: 0 0 8px rgba(245,168,60,.6); }
  .dot-bad { background: #f87171; box-shadow: 0 0 8px rgba(248,113,113,.6); }
  .dot-none { background: #3a4657; }
  .dot-txt { font-size: 12.5px; font-weight: 650; }
  .dot-txt.ok { color: #6ee7b7; }
  .dot-txt.warn { color: #fcd34d; }
  .dot-txt.bad { color: #fca5a5; }
  .dot-txt.none { color: var(--muted-2); }
  .controls { margin: 6px 0 16px; }
  #q { width: 100%; min-height: 48px; font-size: 15px; padding: 11px 18px; border: 1px solid var(--line-strong); border-radius: 999px; background: rgba(17,20,31,.9); color: var(--ink); }
  #q::placeholder { color: var(--muted-2); }
  #q:focus { border-color: rgba(63,214,234,.6); box-shadow: 0 0 0 4px rgba(63,214,234,.12); outline: none; }
  #count { font-size: 13.5px; font-weight: 650; color: var(--brand-bright); margin-top: 8px; }`;

function cell(outcome?: Outcome): string {
  if (!outcome) return '<span class="dot dot-none"></span><span class="dot-txt none">&mdash;</span>';
  return outcome.ok
    ? '<span class="dot dot-ok"></span><span class="dot-txt ok">OK</span>'
    : '<span class="dot dot-bad"></span><span class="dot-txt bad">Falla</span>';
}

function layerStatus(layer: LayerHealth): { cls: string; txt: string } {
  const present = [layer.wms, layer.wfs, layer.arcgis].filter((o): o is Outcome => Boolean(o));
  if (present.length === 0) return { cls: 'none', txt: 'sin servicio' };
  const oks = present.filter((o) => o.ok).length;
  if (oks === present.length) return { cls: 'ok', txt: 'OK' };
  if (oks === 0) return { cls: 'bad', txt: 'Falla' };
  return { cls: 'warn', txt: 'Parcial' };
}

function detailOf(layer: LayerHealth): string {
  const parts = [layer.wms, layer.wfs, layer.arcgis]
    .filter((o): o is Outcome => Boolean(o) && !o!.ok)
    .map((o) => o.detail);
  return parts.length > 0 ? parts.join(' | ') : 'ok';
}

function msOf(layer: LayerHealth): number {
  return [layer.wms, layer.wfs, layer.arcgis]
    .filter((o): o is Outcome => Boolean(o))
    .reduce((acc, o) => acc + o.ms, 0);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}\u2026` : s;
}

const header = `<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="./index.html" aria-label="GeoArg, inicio">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/></svg>
      <span>GeoArg</span>
    </a>
    <nav class="nav" aria-label="Principal">
      <a href="./capas.html">Capas</a>
      <a href="./salud.html" aria-current="page">Salud de capas</a>
      <a class="nav-cta" href="${REPO}">GitHub</a>
    </nav>
  </div>
</header>`;

const footer = `<footer class="site">
      <span>Código MIT · Los datos son de sus organismos publicadores · <a href="${REPO}">Repositorio en GitHub</a></span>
      <span class="made">Hecho por FranPrzDev</span>
    </footer>`;

function buildBody(): string {
  if (!health || !health.totals || !health.layers) {
    return `<section class="hero-slim" aria-labelledby="health-title">
  <div class="wrap">
    <p class="eyebrow">Monitor de salud</p>
    <h1 id="health-title">Salud de capas</h1>
    <p>Todavía no corrió el primer chequeo. El monitoreo se ejecuta a diario vía GitHub Actions y genera esta página a partir de <code>data/health.json</code>.</p>
  </div>
</section>
<main id="main" class="wrap">
  <div class="panel">
    <h2>Sin datos por ahora</h2>
    <p>Cuando el chequeo automático escriba <code>data/health.json</code>, acá vas a ver el estado por fuente y por capa: si el WMS, el WFS o el ArcGIS REST respondieron, la latencia y el detalle de cada falla.</p>
  </div>
  ${footer}
</main>`;
  }

  const t = health.totals;
  const sourceIds = Object.keys(health.sources);
  const sourcesOk = sourceIds.filter((id) => health.sources[id].ok === health.sources[id].total).length;
  const checked = health.checkedAt.replace('T', ' ').slice(0, 16) + ' UTC';

  const sourceRows = sourceIds
    .map((id) => {
      const s = health.sources[id];
      const st = s.ok === s.total ? 'ok' : s.ok === 0 ? 'bad' : 'warn';
      return `<tr>
        <td title="${esc(labelOf(id))}">${esc(provinceOf(id))}</td>
        <td class="detail">${esc(labelOf(id))}</td>
        <td><span class="dot dot-${st}"></span><span class="dot-txt ${st}">${s.ok} / ${s.total}</span></td>
        <td class="mono">${s.avgMs} ms</td>
      </tr>`;
    })
    .join('\n');

  const layerIds = Object.keys(health.layers);
  const rank = (l: LayerHealth): number => {
    const st = layerStatus(l).cls;
    return st === 'bad' ? 0 : st === 'warn' ? 1 : st === 'ok' ? 2 : 3;
  };
  layerIds.sort((a, b) => {
    const d = rank(health!.layers[a]) - rank(health!.layers[b]);
    if (d !== 0) return d;
    return (titleById.get(a) ?? a).localeCompare(titleById.get(b) ?? b, 'es');
  });

  const layerRows = layerIds
    .map((id) => {
      const l = health!.layers[id];
      const st = layerStatus(l);
      const title = titleById.get(id) ?? id;
      const source = id.slice(0, id.indexOf(':')) || id;
      const detail = detailOf(l);
      const hay = norm(`${title} ${id} ${provinceOf(source)} ${labelOf(source)}`);
      return `<tr data-search="${esc(hay)}">
        <td><span class="dot dot-${st.cls}"></span><span class="dot-txt ${st.cls}">${st.txt}</span> <span class="layer-title">${esc(title)}</span><br><code class="typename">${esc(id)}</code></td>
        <td title="${esc(labelOf(source))}">${esc(provinceOf(source))}</td>
        <td>${cell(l.wms)}</td>
        <td>${cell(l.wfs ?? l.arcgis)}</td>
        <td class="mono">${msOf(l)} ms</td>
        <td class="detail" title="${esc(detail)}">${esc(truncate(detail, 90))}</td>
      </tr>`;
    })
    .join('\n');

  return `<section class="hero-slim" aria-labelledby="health-title">
  <div class="wrap">
    <p class="eyebrow">Monitor de salud</p>
    <h1 id="health-title">Salud de capas</h1>
    <p>Chequeo generado el ${esc(checked)} (${health.durationMs} ms): cada servicio declarado se sondeó en vivo. Una capa puede fallar aunque su servidor siga en pie (por ejemplo, una capa puntual caída o un servicio WMS que dejó de responder GetMap).</p>
  </div>
</section>
<main id="main" class="wrap">
  <div class="cards">
    <div class="stat"><p class="k">Capas OK</p><p class="v">${t.layersOk} <small>/ ${t.layers}</small></p></div>
    <div class="stat"><p class="k">Fuentes OK</p><p class="v">${sourcesOk} <small>/ ${sourceIds.length}</small></p></div>
    <div class="stat"><p class="k">Latencia media</p><p class="v">${t.avgMs} <small>ms</small></p></div>
  </div>

  <section class="section-block">
    <h2>Por fuente</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Provincia</th><th>Fuente</th><th>Capas ok / total</th><th>Latencia</th></tr></thead>
        <tbody>
${sourceRows}
        </tbody>
      </table>
    </div>
  </section>

  <section class="section-block">
    <h2>Por capa</h2>
    <div class="controls">
      <input id="q" type="search" placeholder='Buscar capa o fuente: "parcelas", "IGN", "Mendoza"...' aria-label="Buscar capa">
      <div id="count"></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Capa</th><th>Fuente</th><th>WMS</th><th>WFS/ArcGIS</th><th>ms</th><th>Detalle</th></tr></thead>
        <tbody id="rows">
${layerRows}
        </tbody>
      </table>
    </div>
  </section>
  ${footer}
</main>
<script>
const q = document.getElementById('q');
const rows = [...document.querySelectorAll('#rows tr')];
const countEl = document.getElementById('count');
function apply() {
  const terms = q.value.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').split(/\\s+/).filter(Boolean);
  let shown = 0;
  for (const r of rows) {
    const hay = r.dataset.search || '';
    const ok = terms.every(t => hay.includes(t));
    r.hidden = !ok;
    if (ok) shown++;
  }
  countEl.textContent = shown + ' capas';
}
q.addEventListener('input', apply);
apply();
</script>`;
}

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoArg — Salud de capas</title>
<meta name="description" content="Monitor de salud por capa de GeoArg: qué servicios WMS, WFS y ArcGIS REST responden, con latencia y detalle de fallas.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${BASE_CSS}${HEALTH_CSS}
</style>
</head>
<body>
<a class="skip" href="#main">Saltar al contenido</a>
${header}
${buildBody()}
</body>
</html>`;

mkdirSync('docs', { recursive: true });
writeFileSync('docs/salud.html', html);
console.log(`docs/salud.html generated${health ? ` (${health.totals.layers} layers)` : ' (no health.json yet)'}`);
