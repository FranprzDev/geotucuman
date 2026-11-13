import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { searchCatalog } from '../search.js';
import { endpointById } from '../endpoints.js';
import { ServiceType } from '../service-type.js';
import { asText } from '../lib/shared.js';

export const schema = {
  query: z.string().describe('Keyword, e.g. "parcelas", "calles", "cultivos"'),
  relatedTerms: z
    .array(z.string())
    .optional()
    .describe(
      'Synonyms and English/technical equivalents for the query, e.g. ["fire", "hotspot", "MODIS"] for "focos de calor". The catalog metadata is bilingual and uneven; fill this when the concept may be described in another language or with a technical name.',
    ),
  serviceType: z.enum([ServiceType.Wfs, ServiceType.Wms, ServiceType.ArcGis]).optional().describe('Filter by service type'),
  province: z.string().optional().describe('Filter by province, e.g. "Córdoba"'),
};

export const metadata: ToolMetadata = {
  name: 'search_layers',
  description:
    'Search public geographic layers of Argentina (national IGN + provincial sources, WFS/WMS/ArcGIS REST) by keyword in the embedded catalog, ranked by a MiniSearch full-text engine over title, identifier, keywords and abstract (prefix + bounded fuzzy matching; Spanish stemming and accents normalized). Returns typeName, title, abstract, source, province and default CRS. Use serviceType to filter by WFS, WMS or ArcGIS availability and province to narrow to one province. The search is lexical: add synonyms and English/technical equivalents in relatedTerms when the concept may be described differently.',
};

export async function searchLayersHandler({
  query,
  relatedTerms,
  serviceType,
  province,
}: {
  query: string;
  relatedTerms?: string[];
  serviceType?: ServiceType;
  province?: string;
}) {
  const hits = searchCatalog([query, ...(relatedTerms ?? [])].join(' '), { limit: 10, serviceType, province });
  return {
    total: hits.length,
    layers: hits.map((hit) => ({
      typeName: hit.entry.typeName,
      title: hit.entry.title,
      abstract: hit.entry.abstract || null,
      source: hit.entry.source,
      province: hit.entry.province,
      endpoint: hit.entry.endpoint,
      defaultCrs: hit.entry.defaultCrs,
      license: endpointById(hit.entry.source).license.status,
      attribution: endpointById(hit.entry.source).license.attribution,
    })),
    note: 'Catalog generated from GetCapabilities / ArcGIS REST FeatureServer listings. Next step: describe_layer(typeName).',
  };
}

export default async function search_layers(args: InferSchema<typeof schema>) {
  return asText(await searchLayersHandler(args));
}
