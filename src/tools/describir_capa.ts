import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { findLayer } from '../catalog.js';
import { endpointById } from '../endpoints.js';
import { describeFeatureType } from '../wfs.js';
import { asText, described } from '../lib/shared.js';

export const schema = {
  typeName: z.string().describe('Ej: dgct:parcelas'),
};

export const metadata: ToolMetadata = {
  name: 'describir_capa',
  description:
    'Describe los campos reales de una capa (DescribeFeatureType) + metadatos del catálogo. Obligatorio antes de consultar_capa.',
};

export default async function describir_capa({ typeName }: InferSchema<typeof schema>) {
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
}
