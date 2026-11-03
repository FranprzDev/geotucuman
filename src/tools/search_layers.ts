import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { searchLayers } from '../catalog.js';
import { endpointById } from '../endpoints.js';
import { asText } from '../lib/shared.js';

export const schema = {
  query: z.string().describe('Keyword, e.g. "parcelas", "calles", "cultivos"'),
};

export const metadata: ToolMetadata = {
  name: 'search_layers',
  description:
    'Search public geographic layers (Tucuman + national IGN) by keyword in the embedded catalog. Returns typeName, title, abstract, source and default CRS.',
};

export async function searchLayersHandler({ query }: InferSchema<typeof schema>) {
  const hits = searchLayers(query, 10);
  return {
    total: hits.length,
    layers: hits.map((e) => ({
      typeName: e.typeName,
      title: e.title,
      abstract: e.abstract || null,
      source: e.source,
      endpoint: e.endpoint,
      defaultCrs: e.defaultCrs,
      license: endpointById(e.source).license.status,
      attribution: endpointById(e.source).license.attribution,
    })),
    note: 'Catalog generated from GetCapabilities. Next step: describe_layer(typeName).',
  };
}

export default async function search_layers(args: InferSchema<typeof schema>) {
  return asText(await searchLayersHandler(args));
}
