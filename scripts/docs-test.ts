/**
 * Focused documentation checks. Uses Node built-ins only; no network access.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Catalog, CatalogEntry } from '../src/catalog.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 'https://franprzdev.github.io/geotucuman';
const BLOG = `${WEB}/blog`;
const MCP_ENDPOINT = 'https://geoarg-mcp.franprzdev.workers.dev/mcp';
const CLAUDE_COMMAND = `claude mcp add --transport http geoarg ${MCP_ENDPOINT}`;
const SERVICE_ORDER = ['wfs', 'wms', 'arcgis'];

const BLOG_PAGES: Array<{ file: string; url: string; post: boolean }> = [
  { file: 'docs/blog/index.html', url: `${BLOG}/`, post: false },
  { file: 'docs/blog/capas-publicas-por-provincia.html', url: `${BLOG}/capas-publicas-por-provincia.html`, post: true },
  { file: 'docs/blog/wms-vs-wfs.html', url: `${BLOG}/wms-vs-wfs.html`, post: true },
  { file: 'docs/blog/armar-un-mapa-con-tu-agente.html', url: `${BLOG}/armar-un-mapa-con-tu-agente.html`, post: true },
];

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf-8');

const mcpHtml = read('docs/mcp.html');
const landingHtml = read('docs/index.html');
const readme = read('README.md');
const llms = read('docs/llms.txt');

function testMetadataJson(): void {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(mcpHtml);
  assert.ok(match, 'docs/mcp.html must include a JSON-LD metadata block');

  const metadata = JSON.parse(match[1]) as Record<string, unknown>;
  assert.equal(metadata['@context'], 'https://schema.org');
  assert.equal(metadata['@type'], 'SoftwareApplication');
  assert.equal(metadata.name, 'GeoArg');
  assert.equal(metadata.license, 'https://opensource.org/licenses/MIT');
  assert.equal(metadata.isAccessibleForFree, true);
  assert.equal(metadata.codeRepository, 'https://github.com/FranprzDev/geotucuman');
  assert.ok(typeof metadata.description === 'string' && metadata.description.length > 0);
  assert.ok(!('aggregateRating' in metadata), 'metadata must not invent ratings');

  const pkg = JSON.parse(read('package.json')) as { license?: string };
  assert.equal(pkg.license, 'MIT');
}

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

function testRelativeLinks(): void {
  const docsDir = join(ROOT, 'docs');
  const files = htmlFiles(docsDir);
  const attr = /(?:^|\s)(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let checked = 0;

  for (const file of files) {
    const html = readFileSync(file, 'utf-8');
    for (const match of html.matchAll(attr)) {
      const raw = match[1].trim();
      if (!raw || raw.startsWith('#') || raw.startsWith('//')) continue;
      if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(raw)) continue;

      const clean = raw.split('#')[0].split('?')[0];
      if (!clean) continue;
      const target = clean.startsWith('/')
        ? join(docsDir, clean.replace(/^\/+/, ''))
        : resolve(dirname(file), clean);
      assert.ok(
        existsSync(target),
        `${relative(ROOT, file)} has an unresolved relative link: ${raw}`,
      );
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'expected at least one relative documentation link');
}

function testSitemap(): void {
  const sitemap = read('docs/sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sitemap, /<\/urlset>\s*$/);

  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const expected = [
    `${WEB}/`,
    `${WEB}/mcp.html`,
    `${WEB}/capas.html`,
    `${WEB}/salud.html`,
    `${WEB}/ejemplos/focos-tucuman.html`,
    `${BLOG}/`,
    `${BLOG}/capas-publicas-por-provincia.html`,
    `${BLOG}/wms-vs-wfs.html`,
    `${BLOG}/armar-un-mapa-con-tu-agente.html`,
  ];
  assert.deepEqual([...locs].sort(), [...expected].sort());

  for (const loc of locs) {
    const path =
      loc === `${WEB}/`
        ? 'docs/index.html'
        : loc.endsWith('/')
          ? join('docs', loc.slice(WEB.length + 1), 'index.html')
          : join('docs', loc.slice(WEB.length + 1));
    assert.ok(existsSync(join(ROOT, path)), `sitemap URL has no public page: ${loc}`);
  }
}

function testConnectionConsistency(): void {
  const firstParagraph = readme.split(/\r?\n\r?\n/)[1] ?? '';
  assert.match(firstParagraph, /stdio/i, 'README first paragraph must mention local stdio');
  assert.ok(firstParagraph.includes(MCP_ENDPOINT), 'README first paragraph must mention the public endpoint');

  for (const [name, text] of [
    ['README.md', readme],
    ['docs/mcp.html', mcpHtml],
  ] as const) {
    assert.ok(text.includes(MCP_ENDPOINT), `${name} must include the MCP endpoint`);
    assert.ok(text.includes(CLAUDE_COMMAND), `${name} must include the exact Claude Code command`);
  }

  assert.ok(llms.includes(MCP_ENDPOINT), 'docs/llms.txt must include the MCP endpoint');

  const endpointUrls = `${readme}\n${mcpHtml}\n${llms}`.match(
    /https:\/\/geoarg-mcp\.franprzdev\.workers\.dev[^\s"'<>)]*/g,
  ) ?? [];
  const allowed = new Set([MCP_ENDPOINT, MCP_ENDPOINT.replace(/\/mcp$/, '/')]);
  for (const url of endpointUrls.map((value) => value.replace(/[.,;:]$/, ''))) {
    assert.ok(allowed.has(url), `unexpected MCP endpoint URL: ${url}`);
  }
}

function testCoverageWording(): void {
  for (const [name, text] of [
    ['README.md', readme],
    ['docs/mcp.html', mcpHtml],
    ['docs/llms.txt', llms],
  ] as const) {
    assert.match(text, /22 provincias \+ CABA/, `${name} must explain coverage as 22 provinces plus CABA`);
    assert.match(text, /Formosa/, `${name} must state that Formosa is absent`);
    assert.doesNotMatch(text, /Malvinas quedan cubiertas/i, `${name} must not claim full Malvinas coverage`);
  }
}

function testStaleHostingClaims(): void {
  const stale = [
    /hosting futuro/i,
    /sin hosting/i,
    /hosting configurado/i,
    /hosting público/i,
    /no hay hosting/i,
  ];
  for (const [name, text] of [
    ['README.md', readme],
    ['docs/mcp.html', mcpHtml],
    ['docs/llms.txt', llms],
  ] as const) {
    for (const pattern of stale) {
      assert.doesNotMatch(text, pattern, `${name} still contains a stale hosting claim: ${pattern}`);
    }
  }
}

function testGeneratorIdempotence(): void {
  const beforeMcp = read('docs/mcp.html');
  assert.match(beforeMcp, /\n$/, 'docs/mcp.html must end with a newline');
  assert.doesNotMatch(beforeMcp, /\n\n$/, 'docs/mcp.html must end with exactly one newline');
  const beforeLanding = read('docs/index.html');
  const result = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsx'), ['scripts/build-portal.ts'], {
    cwd: ROOT,
    encoding: 'utf-8',
  });
  assert.equal(
    result.status,
    0,
    `build-portal failed:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  );

  assert.equal(read('docs/mcp.html'), beforeMcp, 'generator must reproduce docs/mcp.html');
  const afterLanding = read('docs/index.html');
  assert.equal(afterLanding, beforeLanding, 'generator must keep the landing stable and idempotent');
  assert.ok(
    afterLanding.includes(`<link rel="canonical" href="${WEB}/">`),
    'landing must include its canonical URL',
  );

  const nav = afterLanding.slice(afterLanding.indexOf('<nav class="nav"'), afterLanding.indexOf('</nav>'));
  assert.ok(nav.includes('href="./mcp.html"'), 'landing navigation must link to the docs page');
  const footer = afterLanding.slice(afterLanding.indexOf('<footer class="site">'));
  assert.ok(footer.includes('href="./mcp.html"'), 'landing footer must link to the docs page');
}

function extractCanonical(html: string): string | undefined {
  return /<link rel="canonical" href="([^"]+)">/.exec(html)?.[1];
}

function jsonLdBlocks(html: string): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const parsed: unknown = JSON.parse(match[1]);
    assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'JSON-LD must be an object');
    blocks.push(parsed as Record<string, unknown>);
  }
  return blocks;
}

function readBlogData(file: string): Record<string, unknown> {
  const match = /<script type="application\/json" id="blog-data">([\s\S]*?)<\/script>/.exec(read(file));
  assert.ok(match, `${file} must include a blog-data JSON block`);
  const parsed: unknown = JSON.parse(match[1]);
  assert.ok(
    parsed && typeof parsed === 'object' && !Array.isArray(parsed),
    `${file} blog-data must be an object`,
  );
  return parsed as Record<string, unknown>;
}

function serviceTypes(layer: CatalogEntry): string[] {
  return SERVICE_ORDER.filter((type) => (layer.services ?? []).some((service) => service.type === type));
}

function testBlogPages(): void {
  const sitemap = read('docs/sitemap.xml');
  const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));

  for (const page of BLOG_PAGES) {
    assert.ok(existsSync(join(ROOT, page.file)), `missing blog page: ${page.file}`);
    const html = read(page.file);
    assert.match(html, /<html lang="es">/, `${page.file} must declare Spanish`);
    assert.match(html, /<meta name="description" content="[^"]+">/, `${page.file} needs a meta description`);
    assert.match(html, /<meta property="og:title"/, `${page.file} needs og tags`);
    assert.match(html, /<meta property="og:url"/, `${page.file} needs an og:url`);

    const canonical = extractCanonical(html);
    assert.equal(canonical, page.url, `${page.file} canonical URL`);
    assert.ok(canonical && locs.has(canonical), `${page.file} canonical URL is missing from the sitemap`);

    const blocks = jsonLdBlocks(html);
    assert.ok(blocks.length > 0, `${page.file} must include JSON-LD`);
    for (const block of blocks) {
      assert.ok(!('aggregateRating' in block), `${page.file} must not invent ratings`);
    }
    assert.doesNotMatch(html, /aggregateRating/i, `${page.file} must not mention aggregateRating`);

    if (page.post) {
      const post = blocks[0];
      assert.equal(post['@type'], 'BlogPosting', `${page.file} JSON-LD type`);
      assert.equal(post.datePublished, '2026-11-11', `${page.file} datePublished`);
      assert.ok(!('publisher' in post), `${page.file} must not invent a publisher`);
      const author = post.author;
      assert.ok(author && typeof author === 'object', `${page.file} author`);
      assert.equal((author as Record<string, unknown>)['@type'], 'Person');
      assert.equal((author as Record<string, unknown>).name, 'FranPrzDev');
      assert.match(html, /Resumen/, `${page.file} must start with a Resumen paragraph`);
    }
  }
}

function testBlogNumbers(): void {
  const catalog = JSON.parse(read('data/catalog.json')) as Catalog;

  const byProvince = new Map<string, CatalogEntry[]>();
  for (const layer of catalog.layers) {
    const list = byProvince.get(layer.province);
    if (list) list.push(layer);
    else byProvince.set(layer.province, [layer]);
  }
  const jurisdictions = [...byProvince.entries()]
    .map(([province, layers]) => ({ province, count: layers.length }))
    .sort((a, b) => b.count - a.count || a.province.localeCompare(b.province, 'es'));
  const thin = jurisdictions
    .filter((item) => item.count >= 1 && item.count <= 9)
    .sort((a, b) => a.count - b.count || a.province.localeCompare(b.province, 'es'));

  const wfsJurisdictions = jurisdictions.filter((item) =>
    byProvince.get(item.province)?.some((layer) => serviceTypes(layer).includes('wfs')),
  ).length;
  const wmsOnlyJurisdictions = jurisdictions.filter((item) =>
    byProvince.get(item.province)?.every((layer) => {
      const types = serviceTypes(layer);
      return types.length > 0 && types.every((type) => type === 'wms');
    }),
  ).length;
  const arcgisOnlyJurisdictions = jurisdictions.filter((item) =>
    byProvince.get(item.province)?.every((layer) => {
      const types = serviceTypes(layer);
      return types.length > 0 && types.every((type) => type === 'arcgis');
    }),
  ).length;

  const provinceData = readBlogData('docs/blog/capas-publicas-por-provincia.html');
  assert.equal(provinceData.total, catalog.layers.length, 'province post total');
  assert.deepEqual(provinceData.jurisdictions, jurisdictions, 'province post jurisdiction counts');
  assert.deepEqual(provinceData.top, jurisdictions.slice(0, 5).map((item) => item.province), 'province post top 5');
  assert.deepEqual(provinceData.thin, thin.map((item) => item.province), 'province post thin list');
  assert.equal(provinceData.wfsJurisdictions, wfsJurisdictions, 'province post WFS jurisdictions');
  assert.equal(provinceData.wmsOnlyJurisdictions, wmsOnlyJurisdictions, 'province post WMS-only jurisdictions');
  assert.equal(provinceData.arcgisOnlyJurisdictions, arcgisOnlyJurisdictions, 'province post ArcGIS-only jurisdictions');

  const both = catalog.layers.filter((layer) => {
    const types = serviceTypes(layer);
    return types.includes('wfs') && types.includes('wms');
  }).length;
  const wmsOnly = catalog.layers.filter((layer) => {
    const types = serviceTypes(layer);
    return types.length === 1 && types[0] === 'wms';
  }).length;
  const wfsOnly = catalog.layers.filter((layer) => {
    const types = serviceTypes(layer);
    return types.length === 1 && types[0] === 'wfs';
  }).length;
  const arcgis = catalog.layers.filter((layer) => {
    const types = serviceTypes(layer);
    return types.length === 1 && types[0] === 'arcgis';
  }).length;

  const serviceData = readBlogData('docs/blog/wms-vs-wfs.html');
  assert.equal(serviceData.total, catalog.layers.length, 'service post total');
  assert.equal(serviceData.both, both, 'service post WFS+WMS count');
  assert.equal(serviceData.wmsOnly, wmsOnly, 'service post WMS-only count');
  assert.equal(serviceData.wfsOnly, wfsOnly, 'service post WFS-only count');
  assert.equal(serviceData.arcgis, arcgis, 'service post ArcGIS count');

  const agua = catalog.layers.filter((layer) => /agua/i.test(layer.title) || /agua/i.test(layer.abstract));
  const aguaJurisdictions = new Set(agua.map((layer) => layer.province)).size;
  const agentData = readBlogData('docs/blog/armar-un-mapa-con-tu-agente.html');
  assert.equal(agentData.aguaTotal, agua.length, 'agent post agua total');
  assert.equal(agentData.aguaJurisdictions, aguaJurisdictions, 'agent post agua jurisdictions');

  const examples = agentData.examples as unknown;
  assert.ok(Array.isArray(examples) && examples.length === 3, 'agent post must list 3 examples');
  const byId = new Map(catalog.layers.map((layer) => [layer.id, layer]));
  for (const raw of examples as unknown[]) {
    assert.ok(raw && typeof raw === 'object', 'agent example must be an object');
    const example = raw as Record<string, unknown>;
    const layer = byId.get(example.id as string);
    assert.ok(layer, `agent example is not in the catalog: ${String(example.id)}`);
    assert.equal(example.title, layer.title, 'agent example title');
    assert.equal(example.province, layer.province, 'agent example province');
    assert.deepEqual(example.services, serviceTypes(layer), 'agent example services');
    assert.match(`${layer.title} ${layer.abstract}`, /agua/i, 'agent example must mention agua');
  }
}

const tests: Array<[string, () => void]> = [
  ['metadata JSON', testMetadataJson],
  ['relative documentation links', testRelativeLinks],
  ['sitemap URLs', testSitemap],
  ['blog pages, canonical URLs and JSON-LD', testBlogPages],
  ['blog numbers from the catalog', testBlogNumbers],
  ['connection command and endpoint consistency', testConnectionConsistency],
  ['coverage wording', testCoverageWording],
  ['stale hosting claims', testStaleHostingClaims],
  ['generator output', testGeneratorIdempotence],
];

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

if (failed > 0) {
  console.error(`${failed} documentation test(s) failed`);
  process.exit(1);
}
console.log(`${tests.length} documentation tests passed`);
