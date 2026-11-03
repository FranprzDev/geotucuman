import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { geocode as georefGeocode } from '../georef.js';
import { asText } from '../lib/shared.js';

export const schema = {
  text: z.string().describe('E.g. "Yerba Buena, Tucumán"'),
};

export const metadata: ToolMetadata = {
  name: 'geocode',
  description: 'Geocode free text (locality, municipality, department, province) with the national Georef API. Free, no key.',
};

export async function geocodeHandler({ text }: InferSchema<typeof schema>) {
  const hits = await georefGeocode(text);
  return {
    total: hits.length,
    candidates: hits,
    note: hits.length === 0 ? 'No results or Georef unavailable at this time.' : undefined,
  };
}

export default async function geocode(args: InferSchema<typeof schema>) {
  return asText(await geocodeHandler(args));
}
