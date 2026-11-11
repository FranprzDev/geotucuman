/**
 * GeoArg MCP, public HTTP deployment as a Cloudflare Worker (Module Worker).
 *
 * Implements MCP "Streamable HTTP" in a stateless, JSON-RPC 2.0, JSON-only way
 * (no SSE, no sessions). It does NOT use xmcp: it reuses the exported
 * `*Handler` functions from src/tools and the zod `schema` shapes for tools/list.
 */

import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import catalogJson from '../data/catalog.json' with { type: 'json' };
import { primeCatalog } from '../src/catalog.js';
import type { Catalog } from '../src/catalog.js';
import { toLegacyPayload } from '../src/lib/legacy.js';
import { searchLayersHandler, schema as searchLayersSchema, metadata as searchLayersMetadata } from '../src/tools/search_layers.js';
import { suggestLayersHandler, schema as suggestLayersSchema, metadata as suggestLayersMetadata } from '../src/tools/suggest_layers.js';
import { describeLayerHandler, schema as describeLayerSchema, metadata as describeLayerMetadata } from '../src/tools/describe_layer.js';
import { queryLayerHandler, schema as queryLayerSchema, metadata as queryLayerMetadata } from '../src/tools/query_layer.js';
import { geocodeHandler, schema as geocodeSchema, metadata as geocodeMetadata } from '../src/tools/geocode.js';
import { schema as buscarCapasSchema, metadata as buscarCapasMetadata } from '../src/tools/buscar_capas.js';
import { schema as describirCapaSchema, metadata as describirCapaMetadata } from '../src/tools/describir_capa.js';
import { schema as consultarCapaSchema, metadata as consultarCapaMetadata } from '../src/tools/consultar_capa.js';
import { schema as geocodificarSchema, metadata as geocodificarMetadata } from '../src/tools/geocodificar.js';

const VERSION = packageJson.version;

const REPO_URL = 'https://github.com/franprzdev/geotucuman';
const WEB_URL = 'https://franprzdev.github.io/geotucuman/';

// The Worker imports the catalog JSON directly, so seed the in-memory cache at
// module init. loadCatalog() (called by the handlers) then never reads from fs.
primeCatalog(catalogJson as unknown as Catalog);

const PROTOCOL_VERSION = '2025-03-26';

const SERVER_INFO = { name: 'geoarg-mcp', version: VERSION };

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/** Converts a tool's raw zod shape into a JSON Schema for tools/list. */
function toInputSchema(shape: z.ZodRawShape): Record<string, unknown> {
  return z.toJSONSchema(z.object(shape)) as Record<string, unknown>;
}

type ToolArgs = Record<string, unknown>;

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Validates the (unknown) call arguments and runs the handler. */
  run: (args: ToolArgs) => Promise<unknown>;
}

const argsSchemaByTool = {
  search_layers: z.object(searchLayersSchema),
  suggest_layers: z.object(suggestLayersSchema),
  describe_layer: z.object(describeLayerSchema),
  query_layer: z.object(queryLayerSchema),
  geocode: z.object(geocodeSchema),
  buscar_capas: z.object(buscarCapasSchema),
  describir_capa: z.object(describirCapaSchema),
  consultar_capa: z.object(consultarCapaSchema),
  geocodificar: z.object(geocodificarSchema),
};

const TOOLS: ToolDefinition[] = [
  {
    name: searchLayersMetadata.name,
    description: searchLayersMetadata.description,
    inputSchema: toInputSchema(searchLayersSchema),
    run: (args) => searchLayersHandler(argsSchemaByTool.search_layers.parse(args)),
  },
  {
    name: suggestLayersMetadata.name,
    description: suggestLayersMetadata.description,
    inputSchema: toInputSchema(suggestLayersSchema),
    run: (args) => suggestLayersHandler(argsSchemaByTool.suggest_layers.parse(args)),
  },
  {
    name: describeLayerMetadata.name,
    description: describeLayerMetadata.description,
    inputSchema: toInputSchema(describeLayerSchema),
    run: (args) => describeLayerHandler(argsSchemaByTool.describe_layer.parse(args)),
  },
  {
    name: queryLayerMetadata.name,
    description: queryLayerMetadata.description,
    inputSchema: toInputSchema(queryLayerSchema),
    run: (args) => queryLayerHandler(argsSchemaByTool.query_layer.parse(args) as Parameters<typeof queryLayerHandler>[0]),
  },
  {
    name: geocodeMetadata.name,
    description: geocodeMetadata.description,
    inputSchema: toInputSchema(geocodeSchema),
    run: (args) => geocodeHandler(argsSchemaByTool.geocode.parse(args)),
  },
  // Spanish legacy aliases (deprecated): same behavior as their English tools,
  // with the same argument mapping and legacy payload translation as src/tools/*.
  {
    name: buscarCapasMetadata.name,
    description: buscarCapasMetadata.description,
    inputSchema: toInputSchema(buscarCapasSchema),
    run: async (args) => toLegacyPayload('search_layers', await searchLayersHandler(argsSchemaByTool.buscar_capas.parse(args))),
  },
  {
    name: describirCapaMetadata.name,
    description: describirCapaMetadata.description,
    inputSchema: toInputSchema(describirCapaSchema),
    run: async (args) => toLegacyPayload('describe_layer', await describeLayerHandler(argsSchemaByTool.describir_capa.parse(args))),
  },
  {
    name: consultarCapaMetadata.name,
    description: consultarCapaMetadata.description,
    inputSchema: toInputSchema(consultarCapaSchema),
    run: async (args) =>
      toLegacyPayload('query_layer', await queryLayerHandler(argsSchemaByTool.consultar_capa.parse(args) as Parameters<typeof queryLayerHandler>[0])),
  },
  {
    name: geocodificarMetadata.name,
    description: geocodificarMetadata.description,
    inputSchema: toInputSchema(geocodificarSchema),
    run: async (args) => {
      const { texto } = argsSchemaByTool.geocodificar.parse(args);
      return toLegacyPayload('geocode', await geocodeHandler({ text: texto }));
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

function asToolResult(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function asToolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Authorization',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: CORS_HEADERS });
}

async function handleToolsCall(id: JsonRpcId, params: Record<string, unknown> | undefined) {
  const name = typeof params?.name === 'string' ? params.name : undefined;
  if (!name) {
    return rpcError(id, -32602, 'Invalid params: "name" is required.');
  }
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    return rpcError(id, -32602, `Unknown tool: ${name}`);
  }
  const rawArgs = params?.arguments;
  const args: ToolArgs = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as ToolArgs) : {};
  try {
    const payload = await tool.run(args);
    return rpcResult(id, asToolResult(payload));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return rpcError(id, -32602, `Invalid params for ${name}: ${err.message}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    return rpcResult(id, asToolError(message));
  }
}

/** Handles a single JSON-RPC message. Returns null for notifications (no response). */
async function handleMessage(message: unknown): Promise<object | null> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return rpcError(null, -32600, 'Invalid Request');
  }
  const msg = message as Partial<JsonRpcRequest>;
  const hasId = 'id' in msg && msg.id !== undefined;
  // Response messages (id + result/error, no method) are ignored in a stateless server.
  if (typeof msg.method !== 'string') {
    if (hasId && !('method' in msg)) return null;
    return rpcError((msg.id ?? null) as JsonRpcId, -32600, 'Invalid Request');
  }
  const id = (msg.id ?? null) as JsonRpcId;
  switch (msg.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'notifications/initialized':
      return null;
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    case 'tools/call':
      return handleToolsCall(id, msg.params);
    default:
      return hasId ? rpcError(id, -32601, `Method not found: ${msg.method}`) : null;
  }
}

async function handleMcpPost(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error: request body is not valid JSON.'), 400);
  }

  if (Array.isArray(body)) {
    if (body.length === 0) {
      return jsonResponse(rpcError(null, -32600, 'Invalid Request: empty batch.'), 400);
    }
    const responses = (await Promise.all(body.map((message) => handleMessage(message)))).filter(
      (response): response is object => response !== null,
    );
    if (responses.length === 0) return emptyResponse(202);
    return jsonResponse(responses);
  }

  const response = await handleMessage(body);
  if (response === null) return emptyResponse(202);
  return jsonResponse(response);
}

function endpointInfo(): Response {
  return jsonResponse(
    {
      name: SERVER_INFO.name,
      version: VERSION,
      description:
        'Public MCP server to discover and query Argentine public geodata (national IGN + provincial WFS/WMS/ArcGIS REST + Georef geocoding). Stateless and read-only.',
      protocol: PROTOCOL_VERSION,
      transport: 'streamable-http',
      endpoint: '/mcp',
      stateless: true,
      repository: REPO_URL,
      web: WEB_URL,
    },
    200,
    { 'Cache-Control': 'public, max-age=3600' },
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return emptyResponse(204);
    }

    const isMcpPath = url.pathname === '/mcp' || url.pathname === '/';

    if (request.method === 'POST') {
      if (isMcpPath) return handleMcpPost(request);
      return jsonResponse(rpcError(null, -32600, 'Invalid Request'), 405, { Allow: 'GET, POST, OPTIONS' });
    }

    if (request.method === 'GET') {
      if (url.pathname === '/') return endpointInfo();
      // No SSE / server-initiated stream: GET on /mcp is not supported.
      return jsonResponse({ error: 'Method Not Allowed' }, 405, { Allow: 'GET, POST, OPTIONS' });
    }

    return jsonResponse({ error: 'Method Not Allowed' }, 405, { Allow: 'GET, POST, OPTIONS' });
  },
};
