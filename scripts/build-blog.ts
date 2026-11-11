/**
 * Builds the static blog under docs/blog/ from data/catalog.json.
 *
 * Three posts plus an index. Every count shown in the pages is derived from
 * the catalog at build time and embedded twice: once as readable HTML and once
 * as a machine-readable <script type="application/json" id="blog-data"> block
 * that scripts/docs-test.ts recomputes and compares against.
 *
 * The visual chrome (CSS, header, footer) is copied from docs/mcp.html at build
 * time, with relative links moved from ./ to ../ and a Blog entry marked
 * aria-current. No external dependencies.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Catalog, CatalogEntry } from '../src/catalog.js';

const REPO = 'https://github.com/FranprzDev/geotucuman';
const WEB = 'https://franprzdev.github.io/geotucuman';
const BLOG_URL = `${WEB}/blog/`;
const MCP_ENDPOINT = 'https://geoarg-mcp.franprzdev.workers.dev/mcp';
/** Blog publication date, fixed by the task; not a figure derived from the catalog. */
const PUBLISHED = '2026-11-11';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const json = (value: unknown): string => JSON.stringify(value, null, 2).replace(/</g, '\\u003c');

const SERVICE_LABEL: Record<string, string> = { wfs: 'WFS', wms: 'WMS', arcgis: 'ArcGIS REST' };
const SERVICE_ORDER = ['wfs', 'wms', 'arcgis'];

/** Short names for the sources that appear in the catalog. INTA nodes share one label. */
const SOURCE_SHORT: Record<string, string> = {
  geosplan: 'Geosplan',
  dgct: 'Catastro Tucumán',
  ign: 'IGN',
  rides: 'RIDES',
  caba: 'CABA',
  ideba: 'IDEBA',
  idecor: 'IDECOR',
  entrerios: 'IDE Entre Ríos',
  idechaco: 'IDEChaco',
  idejuy: 'IDEJuy',
  misiones: 'Vialidad Misiones',
  neuquen: 'Catastro Neuquén',
  idern: 'IDERN',
  salta: 'IDE Salta',
  sanjuan: 'UNIDE',
  sanluis: 'Catastro San Luis',
  santacruz: 'SIT Santa Cruz',
  tdf: 'IDE TDF',
  mendoza: 'IDE Mendoza',
};
const shortSource = (id: string): string =>
  SOURCE_SHORT[id] ?? (id.startsWith('inta_') ? 'INTA' : id);

const serviceTypes = (l: CatalogEntry): string[] =>
  SERVICE_ORDER.filter((t) => (l.services ?? []).some((s) => s.type === t));
const serviceLabel = (t: string): string => SERVICE_LABEL[t] ?? t;

const AGUA_RE = /agua/i;
const matchesAgua = (l: CatalogEntry): boolean =>
  AGUA_RE.test(l.title) || AGUA_RE.test(l.abstract);

interface JurisdictionStat {
  province: string;
  count: number;
  services: string;
  sources: string;
}

/** Computes every figure used across the blog. */
function computeStats(catalog: Catalog) {
  const byProvince = new Map<string, CatalogEntry[]>();
  for (const l of catalog.layers) {
    const list = byProvince.get(l.province);
    if (list) list.push(l);
    else byProvince.set(l.province, [l]);
  }

  const jurisdictions: JurisdictionStat[] = [...byProvince.entries()]
    .map(([province, layers]) => {
      const types = new Set<string>();
      for (const l of layers) for (const t of serviceTypes(l)) types.add(t);
      const sources = [...new Set(layers.map((l) => l.source))]
        .sort()
        .map(shortSource)
        .join(', ');
      return {
        province,
        count: layers.length,
        services: SERVICE_ORDER.filter((t) => types.has(t)).map(serviceLabel).join(' + '),
        sources,
      };
    })
    .sort((a, b) => b.count - a.count || a.province.localeCompare(b.province, 'es'));

  const top = jurisdictions.slice(0, 5);
  const thin = jurisdictions
    .filter((j) => j.count >= 1 && j.count <= 9)
    .sort((a, b) => a.count - b.count || a.province.localeCompare(b.province, 'es'));
  const thinInta = thin.filter((j) =>
    byProvince.get(j.province)?.every((l) => l.source.startsWith('inta_')),
  );

  const wfsJurisdictions = jurisdictions.filter((j) =>
    byProvince.get(j.province)?.some((l) => serviceTypes(l).includes('wfs')),
  ).length;
  const wmsOnlyJurisdictions = jurisdictions.filter((j) =>
    byProvince.get(j.province)?.every((l) => {
      const types = serviceTypes(l);
      return types.length > 0 && types.every((t) => t === 'wms');
    }),
  ).length;
  const arcgisOnlyJurisdictions = jurisdictions.filter((j) =>
    byProvince.get(j.province)?.every((l) => {
      const types = serviceTypes(l);
      return types.length > 0 && types.every((t) => t === 'arcgis');
    }),
  ).length;

  const both = catalog.layers.filter((l) => {
    const t = serviceTypes(l);
    return t.includes('wfs') && t.includes('wms');
  }).length;
  const wmsOnly = catalog.layers.filter((l) => {
    const t = serviceTypes(l);
    return t.length === 1 && t[0] === 'wms';
  }).length;
  const wfsOnly = catalog.layers.filter((l) => {
    const t = serviceTypes(l);
    return t.length === 1 && t[0] === 'wfs';
  }).length;
  const arcgis = catalog.layers.filter((l) => {
    const t = serviceTypes(l);
    return t.length === 1 && t[0] === 'arcgis';
  }).length;

  const aguaLayers = catalog.layers.filter(matchesAgua);
  const aguaJurisdictions = new Set(aguaLayers.map((l) => l.province)).size;
  const examples = pickAguaExamples(aguaLayers);

  return {
    total: catalog.layers.length,
    jurisdictionCount: jurisdictions.length,
    subnationalCount: jurisdictions.filter((j) => j.province !== 'Argentina (nacional)').length,
    provinceCount: jurisdictions.filter(
      (j) => j.province !== 'Argentina (nacional)' && j.province !== 'Ciudad Autónoma de Buenos Aires',
    ).length,
    generatedDate: catalog.generatedAt.slice(0, 10),
    jurisdictions,
    top,
    thin,
    thinInta,
    wfsJurisdictions,
    wmsOnlyJurisdictions,
    arcgisOnlyJurisdictions,
    both,
    wmsOnly,
    wfsOnly,
    arcgis,
    aguaTotal: aguaLayers.length,
    aguaJurisdictions,
    examples,
  };
}

/**
 * Picks three real examples for the "agua" objective without hardcoding them:
 * first one layer per distinct service profile (so an image-only WMS layer is
 * represented), then fills with distinct jurisdictions. Ties break on province
 * and title, so the result is deterministic.
 */
function pickAguaExamples(layers: CatalogEntry[]): CatalogEntry[] {
  const readable = layers.filter((l) => l.title.length > 0 && !l.title.includes('_'));
  const sorted = [...readable].sort(
    (a, b) => a.province.localeCompare(b.province, 'es') || a.title.localeCompare(b.title, 'es'),
  );
  const chosen: CatalogEntry[] = [];
  const usedProfiles = new Set<string>();
  const usedProvinces = new Set<string>();
  const profile = (l: CatalogEntry): string => serviceTypes(l).join('+');

  for (const l of sorted) {
    const p = profile(l);
    if (usedProfiles.has(p)) continue;
    usedProfiles.add(p);
    usedProvinces.add(l.province);
    chosen.push(l);
    if (chosen.length >= 3) break;
  }
  for (const l of sorted) {
    if (usedProvinces.has(l.province)) continue;
    usedProvinces.add(l.province);
    chosen.push(l);
    if (chosen.length >= 3) break;
  }

  return chosen.sort(
    (a, b) => a.province.localeCompare(b.province, 'es') || a.title.localeCompare(b.title, 'es'),
  );
}

/** Extracts the CSS, header and footer from docs/mcp.html and rewrites links for /blog/. */
function loadChrome(): { style: string; header: string; footer: string } {
  const mcp = readFileSync('docs/mcp.html', 'utf-8');
  const style = /<style>([\s\S]*?)<\/style>/.exec(mcp);
  const header = /<header class="site-header">[\s\S]*?<\/header>/.exec(mcp);
  const footer = /<footer class="site">[\s\S]*?<\/footer>/.exec(mcp);
  if (!style || !header || !footer) {
    throw new Error('docs/mcp.html must include a <style>, a site header and a site footer');
  }

  const blogHeader = header[0]
    .replace(/href="\.\//g, 'href="../')
    .replace(/ aria-current="page"/g, '')
    .replace(
      '<a href="../mcp.html">Documentación MCP</a>',
      '<a href="../mcp.html">Documentación MCP</a>\n      <a href="./index.html" aria-current="page">Blog</a>',
    );
  const blogFooter = footer[0].replace(/href="\.\//g, 'href="../');

  return { style: style[1], header: blogHeader, footer: blogFooter };
}

const chrome = loadChrome();

interface PageOptions {
  title: string;
  description: string;
  canonical: string;
  ogType: string;
  jsonLd: unknown;
  body: string;
}

function page(options: PageOptions): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)}</title>
<meta name="description" content="${esc(options.description)}">
<link rel="canonical" href="${options.canonical}">
<meta property="og:title" content="${esc(options.title)}">
<meta property="og:description" content="${esc(options.description)}">
<meta property="og:type" content="${options.ogType}">
<meta property="og:url" content="${options.canonical}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z' fill='none' stroke='%233fd6ea' stroke-width='1.7'/%3E%3Ccircle cx='12' cy='10' r='2.6' fill='%233fd6ea'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<script type="application/ld+json">${json(options.jsonLd)}</script>
<style>${chrome.style}</style>
</head>
<body>
<a class="skip" href="#main">Saltar al contenido</a>
${chrome.header}
<main id="main" class="wrap">
${options.body}
</main>
${chrome.footer}
</body>
</html>
`;
}

function blogPostingJsonLd(headline: string, description: string, canonical: string): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline,
    description,
    inLanguage: 'es-AR',
    datePublished: PUBLISHED,
    dateModified: PUBLISHED,
    author: { '@type': 'Person', name: 'FranPrzDev' },
    mainEntityOfPage: canonical,
    url: canonical,
  };
}

function backLink(): string {
  return '    <p class="lede" style="margin:18px 0 0"><a href="./index.html">Blog de GeoArg</a> · <a href="../mcp.html">Documentación del MCP</a></p>\n';
}

function dataTable(headers: string[], rows: string[][]): string {
  const head = headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('');
  const body = rows
    .map((cells) => `        <tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('\n');
  return `  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>
${body}
    </tbody>
  </table>`;
}

function factsScript(value: unknown): string {
  return `<script type="application/json" id="blog-data">${JSON.stringify(value)}</script>`;
}

function sourceNote(stats: ReturnType<typeof computeStats>): string {
  return `  <section class="panel" aria-labelledby="fuente">
    <h2 id="fuente">Fuente de los datos</h2>
    <p>Todos los números de esta nota salen de <code>data/catalog.json</code>, generado el ${stats.generatedDate} (campo <code>generatedAt</code>). Son entradas del catálogo, no capas verificadas en vivo una por una.</p>
    <p><a href="./index.html">Volver al blog</a> · <a href="../mcp.html">Documentación del MCP</a> · <a href="${REPO}">Repositorio en GitHub</a>.</p>
  </section>`;
}

const stats = computeStats(JSON.parse(readFileSync('data/catalog.json', 'utf-8')) as Catalog);

function buildProvincePage(): string {
  const rows = stats.jurisdictions.map((j) => [
    esc(j.province),
    String(j.count),
    esc(j.services),
    esc(j.sources),
  ]);
  const topRows = stats.top.map((j) => [
    esc(j.province),
    String(j.count),
    esc(j.services),
  ]);
  const thinRows = stats.thin.map((j) => [
    esc(j.province),
    String(j.count),
    esc(j.services),
    esc(j.sources),
  ]);

  const description =
    `Conteo de capas del catálogo de GeoArg por jurisdicción argentina: las más y las menos cubiertas, y cuáles solo ofrecen WMS. Datos del catálogo del ${stats.generatedDate}.`;
  const canonical = `${BLOG_URL}capas-publicas-por-provincia.html`;

  const body = `  <section class="hero" aria-labelledby="title">
    <p class="eyebrow">Blog · Catálogo</p>
    <h1 id="title">Qué capas de datos públicos tiene cada provincia argentina</h1>
    <div class="summary">
      <p><strong>Resumen:</strong> el catálogo de GeoArg reúne ${stats.total} capas de servicios oficiales declaradas en fuentes nacionales y provinciales. Esta nota cuenta cuántas entradas hay por jurisdicción, cuáles son las más y las menos cubiertas, y en qué casos la única opción es una imagen WMS. Los números son entradas de catálogo, no capas verificadas una por una en vivo.</p>
    </div>
${backLink()}  </section>

  <section class="panel" aria-labelledby="tabla">
    <h2 id="tabla">Capas por jurisdicción</h2>
    <p>La tabla ordena las ${stats.jurisdictionCount} entradas por jurisdicción presentes en el catálogo (23 jurisdicciones subnacionales más el IGN nacional) por cantidad de entradas. La columna <em>Servicios</em> indica qué tipos de servicio declara la jurisdicción en conjunto; <em>Fuentes</em> lista los organismos de origen.</p>
${dataTable(['Jurisdicción', 'Capas', 'Servicios', 'Fuentes'], rows)}
    <p>La fila <strong>Argentina (nacional)</strong> corresponde al <strong>IGN</strong>, la fuente nacional; no es una provincia. Las jurisdicciones subnacionales representadas son ${stats.subnationalCount} (${stats.provinceCount} provincias + CABA).</p>
  </section>

  <section class="panel" aria-labelledby="top">
    <h2 id="top">Las ${stats.top.length} jurisdicciones con más capas</h2>
    <p>El grueso del catálogo se concentra en pocas fuentes que publican todas sus capas vía GetCapabilities. Esto describe el tamaño del catálogo, no la calidad ni la vigencia de cada capa.</p>
${dataTable(['Jurisdicción', 'Capas', 'Servicios'], topRows)}
  </section>

  <section class="panel" aria-labelledby="flacas">
    <h2 id="flacas">Las jurisdicciones flacas (1 a 9 capas)</h2>
    <p>Hay ${stats.thin.length} jurisdicciones con entre 1 y 9 capas. ${stats.thinInta.length} de ellas son fuentes del <strong>INTA</strong>, que se indexan como WMS-only con una sola capa por nodo; el resto son fuentes chicas.</p>
${dataTable(['Jurisdicción', 'Capas', 'Servicios', 'Fuentes'], thinRows)}
    <p>Estas cifras bajas no significan que la provincia no publique datos: significan que GeoArg solo tiene indexada una parte, a veces un área cartografiada y no la provincia completa.</p>
  </section>

  <section class="panel" aria-labelledby="wfs">
    <h2 id="wfs">WFS y WMS: quién se puede consultar</h2>
    <p>De las ${stats.jurisdictionCount} entradas por jurisdicción, ${stats.wfsJurisdictions} ofrecen al menos una capa <strong>WFS</strong> (features consultables). ${stats.wmsOnlyJurisdictions} son <strong>solo WMS</strong>: entregan imágenes para visualizar, no datos. ${stats.arcgisOnlyJurisdictions} jurisdicción (Mendoza) ofrece solo <strong>ArcGIS REST</strong>, que también es consultable.</p>
    <p>La diferencia importa para <code>query_layer</code>: solo las capas WFS y ArcGIS REST admiten consultas de atributos y filtros. Se detalla en <a href="./wms-vs-wfs.html">WMS vs WFS</a>.</p>
  </section>

  <section class="panel" aria-labelledby="faltan">
    <h2 id="faltan">Lo que falta y advertencias</h2>
    <ul>
      <li><strong>Formosa</strong> no tiene una fuente operativa integrada: su IDE cierra las conexiones WMS/WFS desde fuera de Argentina. La integración está bloqueada del lado del servidor.</li>
      <li>Las <strong>Islas Malvinas</strong> no tienen una capa dedicada ni cobertura completa; solo pueden aparecer en capas específicas del catálogo, con sus propios límites.</li>
      <li>Los conteos son <strong>entradas del catálogo</strong>, no capas verificadas. Que una capa esté indexada no garantiza que el servicio responda hoy. El estado se sigue en <a href="../salud.html">salud de capas</a>.</li>
    </ul>
  </section>

${sourceNote(stats)}
${factsScript({
    total: stats.total,
    jurisdictions: stats.jurisdictions.map((j) => ({ province: j.province, count: j.count })),
    top: stats.top.map((j) => j.province),
    thin: stats.thin.map((j) => j.province),
    wfsJurisdictions: stats.wfsJurisdictions,
    wmsOnlyJurisdictions: stats.wmsOnlyJurisdictions,
    arcgisOnlyJurisdictions: stats.arcgisOnlyJurisdictions,
  })}`;

  return page({
    title: 'Qué capas de datos públicos tiene cada provincia argentina',
    description,
    canonical,
    ogType: 'article',
    jsonLd: blogPostingJsonLd('Qué capas de datos públicos tiene cada provincia argentina', description, canonical),
    body,
  });
}

function buildWmsWfsPage(): string {
  const description =
    `WMS entrega imágenes; WFS y ArcGIS REST entregan datos consultables. Cuántas capas de cada tipo hay en el catálogo de GeoArg y cuál usar. Datos del ${stats.generatedDate}.`;
  const canonical = `${BLOG_URL}wms-vs-wfs.html`;

  const rows = [
    ['WFS + WMS', String(stats.both), 'Se puede ver como imagen y consultar como features'],
    ['Solo WMS', String(stats.wmsOnly), 'Solo imagen para visualizar; no admite GetFeature'],
    ['Solo WFS', String(stats.wfsOnly), 'Solo features; no publica una imagen lista para mostrar'],
    ['Solo ArcGIS REST', String(stats.arcgis), 'Features consultables vía la API REST de ArcGIS'],
  ];

  const body = `  <section class="hero" aria-labelledby="title">
    <p class="eyebrow">Blog · Servicios</p>
    <h1 id="title">WMS vs WFS: cuál usar para tu mapa</h1>
    <div class="summary">
      <p><strong>Resumen:</strong> WMS y WFS resuelven cosas distintas. WMS devuelve una imagen ya dibujada para poner en el mapa; WFS y ArcGIS REST devuelven features que se pueden filtrar, contar y analizar. En el catálogo de GeoArg hay ${stats.both} capas ofrecidas como WFS + WMS, ${stats.wmsOnly} solo WMS, ${stats.wfsOnly} solo WFS y ${stats.arcgis} solo ArcGIS REST.</p>
    </div>
${backLink()}  </section>

  <section class="panel" aria-labelledby="wms">
    <h2 id="wms">WMS: una imagen para mirar</h2>
    <p>WMS (Web Map Service) recibe un pedido con un bbox y un tamaño y devuelve un PNG. El cliente no recibe entidades ni atributos: recibe píxeles ya coloreados por el servidor. Sirve para mostrar una capa de fondo o temática, y no permite preguntar "¿cuántos polígonos hay acá?" ni "¿cuál es el nombre de esta feature?".</p>
  </section>

  <section class="panel" aria-labelledby="wfs">
    <h2 id="wfs">WFS y ArcGIS REST: datos consultables</h2>
    <p>WFS (Web Feature Service) devuelve <em>features</em> con su geometría y sus atributos en GML, GeoJSON o similar. ArcGIS REST cumple el mismo rol a través de la API de ArcGIS (FeatureServer). Con estos servicios se puede filtrar por atributo, pedir solo ciertos campos, contar registros y leer el valor de cada campo.</p>
  </section>

  <section class="panel" aria-labelledby="catalogo">
    <h2 id="catalogo">Qué dice el catálogo</h2>
    <p>Sobre ${stats.total} capas indexadas, la distribución por tipo de servicio es:</p>
${dataTable(['Servicios de la capa', 'Capas', 'Qué permite'], rows)}
    <p>La mayoría de las capas provinciales publica las dos variantes a la vez. Las capas de solo WMS suelen ser servicios que solo exponen visualización.</p>
  </section>

  <section class="panel" aria-labelledby="query">
    <h2 id="query">Qué puede consultar query_layer</h2>
    <p><code>query_layer</code> aplica a capas <strong>WFS</strong> y <strong>ArcGIS REST</strong>. Para las capas solo WMS, <code>query_layer</code> no aplica: el servicio entrega imágenes, no features. Igual se pueden buscar y describir (<code>search_layers</code> y <code>describe_layer</code>) porque sus metadatos están en el catálogo.</p>
  </section>

  <section class="panel" aria-labelledby="regla">
    <h2 id="regla">Una regla práctica</h2>
    <p>Si solo necesitás <strong>ver</strong> la capa, usá WMS. Si necesitás <strong>saber</strong> algo de la capa (contar, filtrar, cruzar, leer atributos), usá WFS o ArcGIS REST. Cuando la capa ofrece las dos, WMS para el fondo y WFS para la consulta.</p>
  </section>

  <section class="panel" aria-labelledby="validar">
    <h2 id="validar">Validá cada capa antes de confiar en ella</h2>
    <p>Algunas capas fallan de forma intermitente, aunque su servicio esté declarado en el catálogo. Antes de consultar, corré <code>describe_layer</code> sobre la capa elegida: si responde, seguí con <code>query_layer</code>. Si falla, probá otra capa o reintentá más tarde. El monitoreo por capa está en <a href="../salud.html">salud de capas</a>.</p>
  </section>

${sourceNote(stats)}
${factsScript({
    total: stats.total,
    both: stats.both,
    wmsOnly: stats.wmsOnly,
    wfsOnly: stats.wfsOnly,
    arcgis: stats.arcgis,
  })}`;

  return page({
    title: 'WMS vs WFS: cuál usar para tu mapa',
    description,
    canonical,
    ogType: 'article',
    jsonLd: blogPostingJsonLd('WMS vs WFS: cuál usar para tu mapa', description, canonical),
    body,
  });
}

function buildAgentPage(): string {
  const description =
    `Cómo pasar de un objetivo en texto libre a un mapa con el agente y las herramientas de GeoArg: search_layers, describe_layer y query_layer. Ejemplo real con el objetivo "agua".`;
  const canonical = `${BLOG_URL}armar-un-mapa-con-tu-agente.html`;

  const exampleRows = stats.examples.map((l) => [
    esc(l.title),
    esc(l.province),
    esc(serviceTypes(l).map(serviceLabel).join(' + ')),
  ]);

  const body = `  <section class="hero" aria-labelledby="title">
    <p class="eyebrow">Blog · Uso</p>
    <h1 id="title">Cómo armar un mapa con tu agente usando GeoArg</h1>
    <div class="summary">
      <p><strong>Resumen:</strong> el agente no dibuja el mapa. Lo que hace es encontrar las capas correctas en el catálogo, mostrar sus campos y dejar listos los pedidos de datos. Con esas piezas, el mapa lo arma tu código. El flujo es <code>search_layers</code> → <code>describe_layer</code> → <code>query_layer</code>, con <code>suggest_layers</code> y <code>geocode</code> como apoyo.</p>
    </div>
${backLink()}  </section>

  <section class="panel" aria-labelledby="flujo">
    <h2 id="flujo">El flujo en pasos</h2>
    <ol>
      <li><code>search_layers</code> (o <code>suggest_layers</code>) encuentra capas candidatas por palabra clave o por objetivo.</li>
      <li><code>describe_layer</code> muestra los campos reales y los servicios de la capa elegida. Es obligatorio antes de consultar.</li>
      <li><code>query_layer</code> pide los features con bbox, filtros y paginación.</li>
      <li><code>geocode</code> convierte un texto en coordenadas cuando necesitás centrar el mapa sin conocer el bbox.</li>
    </ol>
    <p><code>suggest_layers</code> ordena candidatas a partir de un objetivo en texto libre, de forma determinista y sin LLM. <code>geocode</code> usa la API Georef, sin key.</p>
  </section>

  <section class="panel" aria-labelledby="conexion">
    <h2 id="conexion">Conexión</h2>
    <p>Endpoint público Streamable HTTP de GeoArg:</p>
    <pre><code>${MCP_ENDPOINT}</code></pre>
    <p>Configuración genérica para un cliente MCP:</p>
    <pre><code>{
  "mcpServers": {
    "geoarg": {
      "url": "${MCP_ENDPOINT}"
    }
  }
}</code></pre>
    <p>El endpoint es de solo lectura y no requiere API key. Depende de Cloudflare Workers y de servicios oficiales de terceros, así que puede fallar o demorar. Más detalle en <a href="../mcp.html">la documentación del MCP</a>.</p>
  </section>

  <section class="panel" aria-labelledby="agua">
    <h2 id="agua">Ejemplo real: objetivo "agua"</h2>
    <p>Buscando en el catálogo las capas cuyo título o resumen menciona "agua", aparecen <strong>${stats.aguaTotal} capas</strong> en <strong>${stats.aguaJurisdictions} jurisdicciones</strong>. El script elige ${stats.examples.length} ejemplos por perfil de servicio y jurisdicción distinta, sin intervención manual:</p>
${dataTable(['Capa', 'Jurisdicción', 'Servicios'], exampleRows)}
    <p>Con esos tres candidatos el paso siguiente es <code>describe_layer</code> sobre cada uno para ver los campos reales, y recién después <code>query_layer</code>. Las capas solo WMS quedan para el fondo del mapa; las que incluyen WFS o ArcGIS REST se pueden consultar.</p>
  </section>

  <section class="panel" aria-labelledby="limites">
    <h2 id="limites">Qué hace el agente y qué no</h2>
    <p>El agente <strong>sugiere capas</strong>, las describe y arma las consultas. <strong>No construye el mapa por vos</strong>: el render, los estilos y la composición final son de tu código o de tu SIG. GeoArg tampoco aloja los datos: consulta los servicios oficiales en vivo y cita la fuente.</p>
    <p>Un caso aplicado completo está en <a href="../ejemplos/focos-tucuman.html">Focos de calor vs agua en Tucumán</a>, donde el MCP descubre las capas y luego el análisis consulta los servicios directamente.</p>
  </section>

${sourceNote(stats)}
${factsScript({
    aguaTotal: stats.aguaTotal,
    aguaJurisdictions: stats.aguaJurisdictions,
    examples: stats.examples.map((l) => ({
      id: l.id,
      title: l.title,
      province: l.province,
      services: serviceTypes(l),
    })),
  })}`;

  return page({
    title: 'Cómo armar un mapa con tu agente usando GeoArg',
    description,
    canonical,
    ogType: 'article',
    jsonLd: blogPostingJsonLd('Cómo armar un mapa con tu agente usando GeoArg', description, canonical),
    body,
  });
}

const POSTS: Array<{ file: string; title: string; blurb: string; build: () => string }> = [
  {
    file: 'capas-publicas-por-provincia.html',
    title: 'Qué capas de datos públicos tiene cada provincia argentina',
    blurb: 'Conteo de capas por jurisdicción, las más y las menos cubiertas, y quién solo ofrece WMS.',
    build: buildProvincePage,
  },
  {
    file: 'wms-vs-wfs.html',
    title: 'WMS vs WFS: cuál usar para tu mapa',
    blurb: 'La diferencia entre una imagen para mirar y features consultables, con los números del catálogo.',
    build: buildWmsWfsPage,
  },
  {
    file: 'armar-un-mapa-con-tu-agente.html',
    title: 'Cómo armar un mapa con tu agente usando GeoArg',
    blurb: 'El flujo search_layers, describe_layer y query_layer, con un ejemplo real sobre "agua".',
    build: buildAgentPage,
  },
];

function buildIndex(): string {
  const description =
    `Blog de GeoArg: notas sobre las capas de geodatos públicos de Argentina, los tipos de servicio WMS y WFS, y cómo usarlas con un agente. Datos del catálogo del ${stats.generatedDate}.`;
  const canonical = BLOG_URL;
  const items = POSTS.map(
    (post) =>
      `      <li><time datetime="${PUBLISHED}">11/11/2026</time> — <a href="./${post.file}">${esc(post.title)}</a>. ${esc(post.blurb)}</li>`,
  ).join('\n');

  const body = `  <section class="hero" aria-labelledby="title">
    <p class="eyebrow">Blog</p>
    <h1 id="title">Blog de GeoArg</h1>
    <p class="lede">Notas sobre geodatos públicos de Argentina: qué hay en el catálogo, en qué se diferencian los tipos de servicio y cómo usarlos desde un agente. Sin promesas de cobertura total ni de posiciones en buscadores.</p>
  </section>

  <section class="panel" aria-labelledby="notas">
    <h2 id="notas">Notas</h2>
    <ul>
${items}
    </ul>
    <p>El catálogo y las herramientas están documentados en <a href="../mcp.html">la documentación del MCP</a>. El catálogo se regenera desde los servicios oficiales; los conteos de cada nota corresponden a la versión generada el ${stats.generatedDate}.</p>
  </section>`;

  return page({
    title: 'Blog de GeoArg',
    description,
    canonical,
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'Blog de GeoArg',
      description,
      inLanguage: 'es-AR',
      url: canonical,
      author: { '@type': 'Person', name: 'FranPrzDev' },
      blogPost: POSTS.map((post) => `${BLOG_URL}${post.file}`),
    },
    body,
  });
}

function main(): void {
  mkdirSync('docs/blog', { recursive: true });
  writeFileSync('docs/blog/index.html', buildIndex());
  for (const post of POSTS) {
    writeFileSync(`docs/blog/${post.file}`, post.build());
  }
  console.log(`docs/blog/index.html generated (${POSTS.length} posts)`);
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) main();
