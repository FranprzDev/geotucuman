import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { searchLayers, findLayer } from './catalog.js';
import { endpointById } from './endpoints.js';
import { describeFeatureType, getFeature } from './wfs.js';
import { geocode } from './georef.js';
import { epsgCode, reprojectBboxFrom4326 } from './projection.js';

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
        licencia: endpointById(e.source).license.status,
        atribucion: endpointById(e.source).license.attribution,
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
      licencia: ep.license,
      fuentes: [entry.endpoint],
    });
  },
);

server.registerTool(
  'consultar_capa',
  {
    description:
      'Consulta features de una capa WFS (GetFeature). REQUIERE haber llamado describir_capa antes. Geometrías en EPSG:4326 lon,lat. El bbox se pasa en EPSG:4326 (lon,lat) por defecto y se reproyecta en el cliente al CRS nativo de la capa (verificado: estos servidores devuelven 0 si el bbox va en 4326 sobre capa proyectada).',
    inputSchema: {
      typeName: z.string(),
      maxFeatures: z.number().int().min(1).max(50).default(5),
      startIndex: z.number().int().min(0).optional(),
      bbox: z.array(z.number()).length(4).describe('[minLon, minLat, maxLon, maxLat]').optional(),
      bboxCrs: z.string().describe('CRS del bbox; por defecto EPSG:4326. Se reproyecta al CRS nativo de la capa antes de consultar.').optional(),
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
    let nativeBbox: [number, number, number, number] | undefined;
    if (bbox) {
      const fromEpsg = epsgCode(bboxCrs ?? 'EPSG:4326');
      const toEpsg = epsgCode(entry.defaultCrs);
      if (!fromEpsg || !toEpsg) {
        return asText({ error: `No pude interpretar los CRS (bbox: ${bboxCrs ?? 'EPSG:4326'}, capa: ${entry.defaultCrs}).` });
      }
      const raw = bbox as [number, number, number, number];
      if (fromEpsg === '4326') {
        const reproj = reprojectBboxFrom4326(raw, toEpsg);
        if (!reproj) {
          return asText({
            error: `La capa usa EPSG:${toEpsg} y todavía no tengo reproyección para ese CRS. Consultá sin bbox o pedí la capa entera y filtrá vos.`,
          });
        }
        nativeBbox = reproj;
      } else if (fromEpsg === toEpsg) {
        nativeBbox = raw;
      } else {
        return asText({
          error: `bboxCrs=EPSG:${fromEpsg} no soportado: pasá el bbox en EPSG:4326 o en el CRS nativo (EPSG:${toEpsg}).`,
        });
      }
    }
    const fc = await getFeature(ep, entry.typeName, {
      maxFeatures,
      startIndex,
      bbox: nativeBbox,
      bboxCrs: nativeBbox ? `EPSG:${epsgCode(entry.defaultCrs)}` : undefined,
      srsName: 'EPSG:4326',
    });
    const features = (fc.features ?? []).map(truncateGeometry);
    const nextStartIndex = features.length === maxFeatures ? (startIndex ?? 0) + features.length : null;
    return asText({
      typeName: entry.typeName,
      devueltos: features.length,
      totalFeatures: fc.totalFeatures ?? null,
      nextStartIndex,
      features,
      nota: 'Geometrías pedidas en EPSG:4326 (lon,lat). El bbox se reproyectó en el cliente al CRS nativo de la capa. nextStartIndex indica cómo seguir paginando (null si no hay más página evidente).',
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
