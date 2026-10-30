/** Prueba end-to-end del servidor MCP real (dist/server.js) hablando por stdio. PASS/FAIL por check. */
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
const transport = new StdioClientTransport({ command: 'node', args: ['dist/server.js'] });

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

await client.close();

console.log(failures === 0 ? 'MCP SMOKE OK' : `MCP SMOKE: ${failures} fallas`);
process.exit(failures === 0 ? 0 : 1);
