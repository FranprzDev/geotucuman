import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { searchLayers, findLayer } from './catalog.js';
import { endpointById } from './endpoints.js';
import { describeFeatureType, getFeature } from './wfs.js';
import { geocode } from './georef.js';

/** Regla anti-alucinacion (prestada de GeoContext/IGN Francia): no se consulta
 *  una capa sin describirla antes en esta sesion, para no inventar campos. */
const described = new Set<string>();

const MAX_GEOMETRY_CHARS = 4000;

function truncateGeometry(feature: Record<string, unknown>): Record<string, unknown> {
  const geom = feature.geometry;
  if (!geom) return feature;
  const s = JSON.stringify(geom);
  if (s.length <= MAX_GEOMETRY_CHARS) return feature;
  return {
    ...feature,
    geometry: {
      truncada: true,
      bbox: feature.bbox ?? null,
      nota: `Geometria omitida por tamano (${s.length} chars). Pedila con menos features o filtra mas.`,
    },
  };
}

function asText(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

const server = new McpServer({ name: 'geotucuman', version: '0.1.0' });

server.registerTool(
  'buscar_capas',
  {
    description:
      'Busca capas geográficas públicas (Tucumán + nacionales IGN) por palabra clave en el catálogo embebido. Devuelve typeName, título, resumen, fuente y CRS por defecto.',
    inputSchema: { query: z.string().describe('Palabra clave, ej: "parcelas", "calles", "cultivos"') },
  },
  async ({ query }) => {
    const hits = searchLayers(query, 10);
    return asText({
      total: hits.length,
      capas: hits.map((e) => ({
        typeName: e.typeName,
        titulo: e.title,
        resumen: e.abstract || null,
        fuente: e.source,
        endpoint: e.endpoint,
        crsPorDefecto: e.defaultCrs,
      })),
      nota: 'Catalogo generado desde GetCapabilities. Próximo paso: describir_capa(typeName).',
    });
  },
);

server.registerTool(
  'describir_capa',
  {
    description:
      'Describe los campos reales de una capa (DescribeFeatureType) + metadatos del catálogo. Obligatorio antes de consultar_capa.',
    inputSchema: { typeName: z.string().describe('Ej: dgct:parcelas') },
  },
  async ({ typeName }) => {
    const entry = findLayer(typeName);
    if (!entry) {
      return asText({ error: `Capa no encontrada en el catálogo: ${typeName}. Usá buscar_capas primero.` });
    }
    const ep = endpointById(entry.source);
    const fields = await describeFeatureType(ep, entry.typeName);
    described.add(entry.typeName.toLowerCase());
    return asText({
      typeName: entry.typeName,
      titulo: entry.title,
      resumen: entry.abstract || null,
      fuente: entry.source,
      endpoint: entry.endpoint,
      crsPorDefecto: entry.defaultCrs,
      campos: fields,
      fuentes: [entry.endpoint],
    });
  },
);

server.registerTool(
  'consultar_capa',
  {
    description:
      'Consulta features de una capa WFS (GetFeature). REQUIERE haber llamado describir_capa antes. Geometrías en EPSG:4326 lon,lat. El bbox debe ir en el CRS nativo de la capa (verificado: bbox 4326 sobre capa proyectada devuelve 0).',
    inputSchema: {
      typeName: z.string(),
      maxFeatures: z.number().int().min(1).max(50).default(5),
      startIndex: z.number().int().min(0).optional(),
      bbox: z.array(z.number()).length(4).optional(),
      bboxCrs: z.string().optional(),
    },
  },
  async ({ typeName, maxFeatures, startIndex, bbox, bboxCrs }) => {
    const entry = findLayer(typeName);
    if (!entry) {
      return asText({ error: `Capa no encontrada en el catálogo: ${typeName}. Usá buscar_capas primero.` });
    }
    if (!described.has(entry.typeName.toLowerCase())) {
      return asText({
        error: `Regla describe-antes-de-consultar: llamá describir_capa("${entry.typeName}") primero para conocer los campos reales.`,
      });
    }
    const ep = endpointById(entry.source);
    const fc = await getFeature(ep, entry.typeName, {
      maxFeatures,
      startIndex,
      bbox: bbox as [number, number, number, number] | undefined,
      bboxCrs,
      srsName: 'EPSG:4326',
    });
    const features = (fc.features ?? []).map(truncateGeometry);
    return asText({
      typeName: entry.typeName,
      devueltos: features.length,
      totalFeatures: fc.totalFeatures ?? null,
      features,
      nota: 'Geometrías pedidas en EPSG:4326 (lon,lat). El filtro bbox se evalúa en el CRS nativo de la capa.',
      fuentes: [entry.endpoint],
    });
  },
);

server.registerTool(
  'geocodificar',
  {
    description: 'Geocodifica texto libre (localidad, municipio, departamento, provincia) con la API nacional Georef. Gratis, sin key.',
    inputSchema: { texto: z.string().describe('Ej: "Yerba Buena, Tucumán"') },
  },
  async ({ texto }) => {
    const hits = await geocode(texto);
    return asText({
      total: hits.length,
      candidatos: hits,
      nota: hits.length === 0 ? 'Sin resultados o Georef no disponible en este momento.' : undefined,
    });
  },
);

await server.connect(new StdioServerTransport());
