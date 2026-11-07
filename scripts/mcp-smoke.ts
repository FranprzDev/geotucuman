/** End-to-end test of the real MCP server (dist/stdio.js) over stdio. PASS/FAIL per check. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let failures = 0;

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`PASS ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${name}: ${err}`);
  }
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

const client = new Client({ name: 'mcp-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({ command: 'node', args: ['dist/stdio.js'] });

await client.connect(transport);

await check('listTools exposes search_layers/describe_layer/query_layer/geocode plus deprecated aliases', async () => {
  const { tools } = await client.listTools();
  const names = new Set(tools.map((t) => t.name));
  for (const expected of [
    'search_layers',
    'describe_layer',
    'query_layer',
    'geocode',
    'buscar_capas',
    'describir_capa',
    'consultar_capa',
    'geocodificar',
  ]) {
    if (!names.has(expected)) throw new Error(`missing tool ${expected}`);
  }
});

await check("search_layers {query:'parcelas', province:'Tucumán'} mentions dgct:parcelas", async () => {
  const result = await client.callTool({ name: 'search_layers', arguments: { query: 'parcelas', province: 'Tucumán' } });
  if (!textOf(result).includes('dgct:parcelas')) throw new Error('dgct:parcelas does not appear in the response');
});

await check('query_layer without describing first returns the describe-before-query error', async () => {
  const result = await client.callTool({ name: 'query_layer', arguments: { typeName: 'dgct:parcelas' } });
  if (!textOf(result).includes('describe-before-query')) {
    throw new Error('did not return the describe-before-query rule');
  }
});

await check('describe_layer + query_layer with 4326 bbox over a projected layer (EPSG:22183) returns features', async () => {
  await client.callTool({ name: 'describe_layer', arguments: { typeName: 'WFS_GEOSPLAN:jurisdicciones' } });
  const result = await client.callTool({
    name: 'query_layer',
    arguments: {
      typeName: 'WFS_GEOSPLAN:jurisdicciones',
      maxFeatures: 5,
      bbox: [-65.35, -26.95, -65.05, -26.65],
    },
  });
  const parsed = JSON.parse(textOf(result)) as { returned?: number; error?: string };
  if (parsed.error) throw new Error(parsed.error);
  if (!parsed.returned || parsed.returned < 1) throw new Error('reprojected 4326 bbox returned 0 features');
  console.log(`  (returned=${parsed.returned})`);
});

await check('query_layer exposes the source license in describe_layer', async () => {
  const result = await client.callTool({ name: 'describe_layer', arguments: { typeName: 'WFS_GEOSPLAN:jurisdicciones' } });
  if (!textOf(result).includes('license')) throw new Error('describe_layer does not report the license');
});

await check('listTools exposes suggest_layers (9 tools)', async () => {
  const { tools } = await client.listTools();
  const names = new Set(tools.map((t) => t.name));
  if (!names.has('suggest_layers')) throw new Error('missing tool suggest_layers');
});

await check('suggest_layers suggests riego/pozos layers with rationale, services, evidence and noCoverage', async () => {
  const result = await client.callTool({
    name: 'suggest_layers',
    arguments: { goal: 'quiero armar un mapa de riego y pozos', limit: 5 },
  });
  const parsed = JSON.parse(textOf(result)) as {
    candidates?: Array<{ typeName: string; rationale?: string; services?: unknown[]; evidence?: unknown }>;
    noCoverage?: unknown[];
  };
  const candidates = parsed.candidates ?? [];
  if (!candidates.some((c) => /canales|pozos/i.test(c.typeName))) {
    throw new Error('no Canales/Pozos candidate for a riego y pozos goal');
  }
  for (const c of candidates) {
    if (!c.rationale || !Array.isArray(c.services) || !c.evidence) {
      throw new Error(`candidate ${c.typeName} lacks rationale/services/evidence`);
    }
  }
  if (!Array.isArray(parsed.noCoverage)) throw new Error('missing noCoverage array');
});

await check('serviceType filter returns only layers exposing that service', async () => {
  const { findLayer } = await import('../src/catalog.js');
  for (const serviceType of ['wms', 'wfs'] as const) {
    const res = JSON.parse(
      textOf(await client.callTool({ name: 'search_layers', arguments: { query: 'area protegida', serviceType } })),
    ) as { layers?: Array<{ typeName: string }> };
    if ((res.layers ?? []).length === 0) throw new Error(`no layers under the ${serviceType} filter`);
    for (const l of res.layers ?? []) {
      const entry = findLayer(l.typeName);
      if (!(entry?.services ?? []).some((s) => s.type === serviceType)) {
        throw new Error(`${l.typeName} lacks a ${serviceType} service`);
      }
    }
  }
});

await check('describe_layer describes a WMS-only layer without requiring a WFS schema', async () => {
  const result = await client.callTool({ name: 'describe_layer', arguments: { typeName: 'rides:Pozos_de_agua' } });
  const parsed = JSON.parse(textOf(result)) as { error?: string; services?: unknown[] };
  if (parsed.error) throw new Error(parsed.error);
  if (!Array.isArray(parsed.services)) throw new Error('WMS-only card lacks services');
});

await check('consultar_capa alias preserves the Spanish contract (old keys + old tag)', async () => {
  const pending = await client.callTool({ name: 'consultar_capa', arguments: { typeName: 'dgct:parcelas' } });
  if (!textOf(pending).includes('describe-antes-de-consultar')) {
    throw new Error('alias did not return the describe-antes-de-consultar tag');
  }
  const result = await client.callTool({
    name: 'consultar_capa',
    arguments: {
      typeName: 'WFS_GEOSPLAN:jurisdicciones',
      maxFeatures: 5,
      bbox: [-65.35, -26.95, -65.05, -26.65],
    },
  });
  const parsed = JSON.parse(textOf(result)) as { devueltos?: number; nota?: string; returned?: number; error?: string };
  if (parsed.error) throw new Error(parsed.error);
  if (!parsed.devueltos || parsed.devueltos < 1) throw new Error('alias returned 0 features under the devueltos key');
  if (parsed.returned !== undefined) throw new Error('alias leaked the English returned key');
  if (typeof parsed.nota !== 'string') throw new Error('alias did not return the nota key');
  console.log(`  (devueltos=${parsed.devueltos})`);
});

await client.close();

console.log(failures === 0 ? 'MCP SMOKE OK' : `MCP SMOKE: ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
