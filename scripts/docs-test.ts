/**
 * Focused documentation checks. Uses Node built-ins only; no network access.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 'https://franprzdev.github.io/geotucuman';
const MCP_ENDPOINT = 'https://geoarg-mcp.franprzdev.workers.dev/mcp';
const CLAUDE_COMMAND = `claude mcp add --transport http geoarg ${MCP_ENDPOINT}`;

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
  ];
  assert.deepEqual([...locs].sort(), [...expected].sort());

  for (const loc of locs) {
    const path = loc.endsWith('/') ? 'docs/index.html' : join('docs', loc.slice(WEB.length + 1));
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

const tests: Array<[string, () => void]> = [
  ['metadata JSON', testMetadataJson],
  ['relative documentation links', testRelativeLinks],
  ['sitemap URLs', testSitemap],
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
