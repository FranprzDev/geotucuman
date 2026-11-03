import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { asText } from '../lib/shared.js';
import { toLegacyPayload } from '../lib/legacy.js';
import { queryLayerHandler } from './query_layer.js';

export const schema = {
  typeName: z.string(),
  maxFeatures: z.number().int().min(1).max(50).default(5),
  startIndex: z.number().int().min(0).optional(),
  bbox: z.array(z.number()).length(4).describe('[minLon, minLat, maxLon, maxLat]').optional(),
  bboxCrs: z.string().describe('CRS del bbox; por defecto EPSG:4326. Se reproyecta al CRS nativo de la capa antes de consultar.').optional(),
};

export const metadata: ToolMetadata = {
  name: 'consultar_capa',
  description:
    'Deprecated alias for query_layer. Consulta features de una capa WFS (GetFeature). REQUIERE haber llamado describir_capa antes. Geometrías en EPSG:4326 lon,lat. El bbox se pasa en EPSG:4326 (lon,lat) por defecto y se reproyecta en el cliente al CRS nativo de la capa (verificado: estos servidores devuelven 0 si el bbox va en 4326 sobre capa proyectada).',
};

export default async function consultar_capa(args: InferSchema<typeof schema>) {
  const payload = await queryLayerHandler(args);
  return asText(toLegacyPayload('query_layer', payload));
}
