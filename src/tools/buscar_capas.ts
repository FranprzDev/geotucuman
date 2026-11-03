import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { asText } from '../lib/shared.js';
import { toLegacyPayload } from '../lib/legacy.js';
import { searchLayersHandler } from './search_layers.js';

export const schema = {
  query: z.string().describe('Palabra clave, ej: "parcelas", "calles", "cultivos"'),
};

export const metadata: ToolMetadata = {
  name: 'buscar_capas',
  description:
    'Deprecated alias for search_layers. Busca capas geográficas públicas (Tucumán + nacionales IGN) por palabra clave en el catálogo embebido. Devuelve typeName, título, resumen, fuente y CRS por defecto.',
};

export default async function buscar_capas(args: InferSchema<typeof schema>) {
  const payload = await searchLayersHandler(args);
  return asText(toLegacyPayload('search_layers', payload));
}
