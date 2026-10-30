import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { searchLayers } from '../catalog.js';
import { endpointById } from '../endpoints.js';
import { asText } from '../lib/shared.js';

export const schema = {
  query: z.string().describe('Palabra clave, ej: "parcelas", "calles", "cultivos"'),
};

export const metadata: ToolMetadata = {
  name: 'buscar_capas',
  description:
    'Busca capas geográficas públicas (Tucumán + nacionales IGN) por palabra clave en el catálogo embebido. Devuelve typeName, título, resumen, fuente y CRS por defecto.',
};

export default async function buscar_capas({ query }: InferSchema<typeof schema>) {
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
}
