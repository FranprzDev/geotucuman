/** Prueba end-to-end del servidor MCP real (dist/stdio.js) hablando por stdio. PASS/FAIL por check. */
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

await check('listTools expone buscar_capas/describir_capa/consultar_capa/geocodificar', async () => {
  const { tools } = await client.listTools();
  const names = new Set(tools.map((t) => t.name));
  for (const expected of ['buscar_capas', 'describir_capa', 'consultar_capa', 'geocodificar']) {
    if (!names.has(expected)) throw new Error(`falta la tool ${expected}`);
  }
});

await check("buscar_capas {query:'parcelas'} menciona dgct:parcelas", async () => {
  const result = await client.callTool({ name: 'buscar_capas', arguments: { query: 'parcelas' } });
  if (!textOf(result).includes('dgct:parcelas')) throw new Error('dgct:parcelas no aparece en la respuesta');
});

await check("consultar_capa sin describir antes devuelve error describe-antes-de-consultar", async () => {
  const result = await client.callTool({ name: 'consultar_capa', arguments: { typeName: 'dgct:parcelas' } });
  if (!textOf(result).includes('describe-antes-de-consultar')) {
    throw new Error('no devolvio la regla describe-antes-de-consultar');
  }
});

await check("describir_capa + consultar_capa con bbox 4326 sobre capa proyectada (EPSG:22183) devuelve features", async () => {
  await client.callTool({ name: 'describir_capa', arguments: { typeName: 'WFS_GEOSPLAN:jurisdicciones' } });
  const result = await client.callTool({
    name: 'consultar_capa',
    arguments: {
      typeName: 'WFS_GEOSPLAN:jurisdicciones',
      maxFeatures: 5,
      bbox: [-65.35, -26.95, -65.05, -26.65],
    },
  });
  const parsed = JSON.parse(textOf(result)) as { devueltos?: number; error?: string };
  if (parsed.error) throw new Error(parsed.error);
  if (!parsed.devueltos || parsed.devueltos < 1) throw new Error('bbox 4326 reproyectado devolvio 0 features');
  console.log(`  (devueltos=${parsed.devueltos})`);
});

await check("consultar_capa expone licencia de la fuente en describir_capa", async () => {
  const result = await client.callTool({ name: 'describir_capa', arguments: { typeName: 'WFS_GEOSPLAN:jurisdicciones' } });
  if (!textOf(result).includes('licencia')) throw new Error('describir_capa no informa licencia');
});

await client.close();

console.log(failures === 0 ? 'MCP SMOKE OK' : `MCP SMOKE: ${failures} fallas`);
process.exit(failures === 0 ? 0 : 1);
