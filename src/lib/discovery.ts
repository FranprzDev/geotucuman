import type { Catalog, CatalogEntry } from '../catalog.js';
import { ServiceType } from '../service-type.js';

export function discoveryMetadata(entry: CatalogEntry, sources: Catalog['sources']) {
  const services = entry.services ?? [];
  return {
    capabilities: {
      display: services.some((service) => service.type === ServiceType.Wms),
      vectorQuery: services.some(
        (service) => service.type === ServiceType.Wfs || service.type === ServiceType.ArcGis,
      ),
    },
    freshness: {
      catalogSourceStatus: sources[entry.source]?.status ?? null,
      lastVerified: entry.verifiedAt,
      lastDataDate: null,
      isLive: null,
      temporalAnalysisReady: false,
    },
    usageWarning:
      'An advertised vector endpoint is not proof that usable geometries or coverage exist. The verification date is when catalog metadata was checked, not an observation date. No current, live, or temporal claims can be made without querying the live service.',
  };
}
