import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { geocode } from '../georef.js';
import { asText } from '../lib/shared.js';

export const schema = {
  texto: z.string().describe('Ej: "Yerba Buena, Tucumán"'),
};

export const metadata: ToolMetadata = {
  name: 'geocodificar',
  description: 'Geocodifica texto libre (localidad, municipio, departamento, provincia) con la API nacional Georef. Gratis, sin key.',
};

export default async function geocodificar({ texto }: InferSchema<typeof schema>) {
  const hits = await geocode(texto);
  return asText({
    total: hits.length,
    candidatos: hits,
    nota: hits.length === 0 ? 'Sin resultados o Georef no disponible en este momento.' : undefined,
  });
}
