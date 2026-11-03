import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { asText } from '../lib/shared.js';
import { toLegacyPayload } from '../lib/legacy.js';
import { geocodeHandler } from './geocode.js';

export const schema = {
  texto: z.string().describe('Ej: "Yerba Buena, Tucumán"'),
};

export const metadata: ToolMetadata = {
  name: 'geocodificar',
  description: 'Deprecated alias for geocode. Geocodifica texto libre (localidad, municipio, departamento, provincia) con la API nacional Georef. Gratis, sin key.',
};

export default async function geocodificar({ texto }: InferSchema<typeof schema>) {
  const payload = await geocodeHandler({ text: texto });
  return asText(toLegacyPayload('geocode', payload));
}
