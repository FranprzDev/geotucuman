import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const script = readFileSync('.wrangler-dry/index.js', 'utf-8');
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script,
    compatibilityDate: '2026-11-01',
    compatibilityFlags: ['nodejs_compat'],
  }),
);

async function post(body) {
  const res = await mf.dispatchFetch('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

const results = {};

results.initialize = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
results.notification = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
results.ping = await post({ jsonrpc: '2.0', id: 2, method: 'ping' });
results.toolsList = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
results.search = await post({
  jsonrpc: '2.0',
  id: 4,
  method: 'tools/call',
  params: { name: 'search_layers', arguments: { query: 'aeropuerto', province: 'Tucumán' } },
});
results.buscar = await post({
  jsonrpc: '2.0',
  id: 5,
  method: 'tools/call',
  params: { name: 'buscar_capas', arguments: { query: 'aeropuerto' } },
});
results.batch = await post([
  { jsonrpc: '2.0', id: 6, method: 'ping' },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
]);
results.unknownMethod = await post({ jsonrpc: '2.0', id: 7, method: 'nope' });
results.badTool = await post({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nope', arguments: {} } });
results.invalidArgs = await post({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'search_layers', arguments: {} } });
results.reportMiss = await post({
  jsonrpc: '2.0',
  id: 10,
  method: 'tools/call',
  params: {
    name: 'report_miss',
    arguments: { query: 'focos de calor', expectation: 'a layer of active fire hotspots for Tucumán' },
  },
});

const infoRes = await mf.dispatchFetch('http://localhost/');
results.getRoot = { status: infoRes.status, text: await infoRes.text() };
const getMcp = await mf.dispatchFetch('http://localhost/mcp');
results.getMcp = { status: getMcp.status };
const del = await mf.dispatchFetch('http://localhost/mcp', { method: 'DELETE' });
results.delete = { status: del.status };
const opt = await mf.dispatchFetch('http://localhost/mcp', { method: 'OPTIONS' });
results.options = { status: opt.status, cors: opt.headers.get('access-control-allow-origin') };

for (const [name, value] of Object.entries(results)) {
  if (name === 'toolsList' || name === 'search' || name === 'buscar' || name === 'batch' || name === 'getRoot') {
    console.log(`\n### ${name} -> status ${value.status}`);
    console.log(value.text.slice(0, 1200));
  } else {
    console.log(`${name}:`, JSON.stringify(value));
  }
}
let failed = false;
if (results.toolsList.status === 200) {
  const parsed = JSON.parse(results.toolsList.text);
  console.log('\nTOOL NAMES:', parsed.result.tools.map((t) => t.name).join(', '));
  if (!parsed.result.tools.some((t) => t.name === 'report_miss')) {
    console.error('FAIL: tools/list must include report_miss');
    failed = true;
  }
} else {
  console.error('FAIL: tools/list status', results.toolsList.status);
  failed = true;
}
// Without the GITHUB_TOKEN secret (CI), report_miss must fail gracefully with
// a clear tool error, not crash the worker.
{
  const parsed = JSON.parse(results.reportMiss.text);
  const content = parsed.result?.content?.[0]?.text ?? '';
  if (parsed.result?.isError !== true || !/not configured/i.test(content)) {
    console.error('FAIL: report_miss without secret must be a graceful tool error, got:', results.reportMiss.text.slice(0, 300));
    failed = true;
  }
}
if (failed) process.exit(1);

await mf.dispose();
