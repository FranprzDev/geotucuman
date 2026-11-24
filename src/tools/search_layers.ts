import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { searchCatalog } from '../search.js';
import { loadCatalog } from '../catalog.js';
import { endpointById } from '../endpoints.js';
import { ServiceType } from '../service-type.js';
import { discoveryMetadata } from '../lib/discovery.js';
import { layerFlags } from '../lib/flags.js';
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
  limit: z.number().int().min(1).max(20).default(5).describe('Maximum number of layers to return'),
  minScore: z.number().finite().nonnegative().default(0).describe('Minimum relevance score for a layer to be returned'),
};

export const metadata: ToolMetadata = {
  name: 'search_layers',
  description:
    'Search public geographic layers of Argentina (national IGN + provincial sources, WFS/WMS/ArcGIS REST) by keyword in the embedded catalog, ranked by a MiniSearch full-text engine over title, identifier, keywords and abstract (prefix + bounded fuzzy matching; Spanish stemming and accents normalized). Returns rank (1-based), raw score, typeName, title, abstract, source, province and default CRS. Use serviceType to filter by WFS, WMS or ArcGIS availability and province to narrow to one province. Use limit (1-20, default 5) to cap results and minScore to drop weak lexical matches. The search is lexical: add synonyms and English/technical equivalents in relatedTerms when the concept may be described differently.',
};

export async function searchLayersHandler({
  query,
  relatedTerms,
  serviceType,
  province,
  limit = 5,
  minScore = 0,
}: {
  query: string;
  relatedTerms?: string[];
  serviceType?: ServiceType;
  province?: string;
  limit?: number;
  minScore?: number;
}) {
  const catalog = loadCatalog();
  const hits = searchCatalog([query, ...(relatedTerms ?? [])].join(' '), { serviceType, province });
  const selected = hits
    .filter(
      (hit) =>
        hit.score >= minScore &&
        Object.values(hit.match).some((fields) =>
          fields.some((field) => field !== 'province' && field !== 'source'),
        ),
    )
    .slice(0, limit);
  const groupedBySource = Object.fromEntries(
    [...new Set(selected.map((hit) => hit.entry.source))].map((source) => [
      source,
      selected.filter((hit) => hit.entry.source === source).map((hit) => hit.entry.typeName),
    ]),
  );
  return {
    serviceType: serviceType ?? null,
    province: province ?? null,
    minScore,
    total: selected.length,
    layers: selected.map((hit, index) => {
      const entry = hit.entry;
      return {
        rank: index + 1,
        typeName: entry.typeName,
        title: entry.title,
        abstract: entry.abstract || null,
        source: entry.source,
        province: entry.province,
        endpoint: entry.endpoint,
        defaultCrs: entry.defaultCrs,
        score: hit.score,
        license: endpointById(entry.source).license.status,
        attribution: endpointById(entry.source).license.attribution,
        flags: layerFlags(entry, catalog.sources),
        ...discoveryMetadata(entry, catalog.sources),
      };
    }),
    groupedBySource,
    ...(selected.length === 0
      ? {
          message:
            'No lexical matches above minScore within the selected filters. The live service was not queried.',
        }
      : {}),
    note: 'Catalog generated from GetCapabilities / ArcGIS REST FeatureServer listings. Next step: describe_layer(typeName).',
  };
}

export default async function search_layers(args: InferSchema<typeof schema>) {
  return asText(await searchLayersHandler(args));
}
