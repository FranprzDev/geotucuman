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

await check("search_layers {query:'parcelas'} mentions dgct:parcelas", async () => {
  const result = await client.callTool({ name: 'search_layers', arguments: { query: 'parcelas' } });
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
