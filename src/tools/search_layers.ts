import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { searchLayers } from '../catalog.js';
import { endpointById } from '../endpoints.js';
import { ServiceType } from '../service-type.js';
import { asText } from '../lib/shared.js';

export const schema = {
  query: z.string().describe('Keyword, e.g. "parcelas", "calles", "cultivos"'),
  serviceType: z.enum([ServiceType.Wfs, ServiceType.Wms, ServiceType.ArcGis]).optional().describe('Filter by service type'),
  province: z.string().optional().describe('Filter by province, e.g. "Córdoba"'),
};

export const metadata: ToolMetadata = {
  name: 'search_layers',
  description:
    'Search public geographic layers of Argentina (national IGN + provincial sources, WFS/WMS/ArcGIS REST) by keyword in the embedded catalog. Returns typeName, title, abstract, source, province and default CRS. Use serviceType to filter by WFS, WMS or ArcGIS availability and province to narrow to one province.',
};

export async function searchLayersHandler({ query, serviceType, province }: { query: string; serviceType?: ServiceType; province?: string }) {
  const hits = searchLayers(query, 10, serviceType, province);
  return {
    total: hits.length,
    layers: hits.map((e) => ({
      typeName: e.typeName,
      title: e.title,
      abstract: e.abstract || null,
      source: e.source,
      province: e.province,
      endpoint: e.endpoint,
      defaultCrs: e.defaultCrs,
      license: endpointById(e.source).license.status,
      attribution: endpointById(e.source).license.attribution,
    })),
    note: 'Catalog generated from GetCapabilities / ArcGIS REST FeatureServer listings. Next step: describe_layer(typeName).',
  };
}

export default async function search_layers(args: InferSchema<typeof schema>) {
  return asText(await searchLayersHandler(args));
}
