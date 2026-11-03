import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { asText } from '../lib/shared.js';
import { toLegacyPayload } from '../lib/legacy.js';
import { describeLayerHandler } from './describe_layer.js';

export const schema = {
  typeName: z.string().describe('Ej: dgct:parcelas'),
};

export const metadata: ToolMetadata = {
  name: 'describir_capa',
  description:
    'Deprecated alias for describe_layer. Describe los campos reales de una capa (DescribeFeatureType) + metadatos del catálogo. Obligatorio antes de consultar_capa.',
};

export default async function describir_capa(args: InferSchema<typeof schema>) {
  const payload = await describeLayerHandler(args);
  return asText(toLegacyPayload('describe_layer', payload));
}
