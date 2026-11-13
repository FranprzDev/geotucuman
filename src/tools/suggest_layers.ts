import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { loadCatalog } from '../catalog.js';
import { layerFlags } from '../lib/flags.js';
import type { CatalogEntry } from '../catalog.js';
import { endpointById } from '../endpoints.js';
import { ServiceType } from '../service-type.js';
import { meaningfulTerms, searchCatalog, termCovered } from '../search.js';
import type { CatalogSearchHit } from '../search.js';
import { asText } from '../lib/shared.js';

export const schema = {
  goal: z.string().describe('Free-text intent, Spanish or English, e.g. "quiero armar un mapa de riego y pozos"'),
  relatedTerms: z
    .array(z.string())
    .optional()
    .describe(
      'Related terms you (the assistant) consider equivalent for this goal: synonyms, word forms, and English/technical equivalents. The catalog metadata is bilingual and uneven - some layers are described only in Spanish (e.g. "área quemada"), others only in English (e.g. MODIS "fires/hotspots"). For "focos de calor" pass e.g. ["incendio", "fire", "hotspot", "MODIS", "VIIRS"]. Always fill this when the goal uses informal or domain vocabulary.',
    ),
  serviceType: z.enum([ServiceType.Wfs, ServiceType.Wms, ServiceType.ArcGis]).optional().describe('Filter by service type'),
  limit: z.number().int().min(1).max(20).default(10),
};

export const metadata: ToolMetadata = {
  name: 'suggest_layers',
  description:
    'Suggests catalog layers from a free-text goal in Spanish or English (no LLM, no invented layers). Ranking is a MiniSearch full-text engine over each layer\'s title, identifier, keywords and abstract - same pattern as IGN France\'s GeoContext - with prefix and bounded fuzzy matching, with Spanish stemming, so word forms and derivations are handled generally. Lexical search cannot bridge languages or concepts by itself: pass synonyms and English/technical equivalents in relatedTerms. Returns scored candidates with the matched terms as rationale, service capabilities and source evidence, plus goal terms no layer covers (noCoverage).',
};

const CAPABILITY_SEMANTICS: Record<ServiceType, string> = {
  [ServiceType.Wfs]: 'Analyzable/downloadable vector data (GetFeature)',
  [ServiceType.Wms]: 'Display/context map imagery (GetMap)',
  [ServiceType.ArcGis]: 'Vector data via ArcGIS REST query',
};

/** Human-readable rationale from the engine's match detail (term -> fields). */
function rationale(hit: CatalogSearchHit): string {
  const matched = Object.entries(hit.match)
    .map(([term, fields]) => `"${term}" (${fields.join(', ')})`)
    .join(', ');
  return matched.length > 0 ? `Matched ${matched}.` : 'Matched catalog metadata.';
}

export async function suggestLayersHandler({
  goal,
  relatedTerms,
  serviceType,
  limit = 10,
}: {
  goal: string;
  relatedTerms?: string[];
  serviceType?: ServiceType;
  limit?: number;
}) {
  const catalog = loadCatalog();
  const query = [goal, ...(relatedTerms ?? [])].join(' ');
  const hits = searchCatalog(query, { serviceType });
  const goalTerms = meaningfulTerms(goal);
  // Goal terms with no coverage in the catalog at all, reported honestly so
  // the caller knows what to rephrase or drop.
  const noCoverage = goalTerms.filter((term) => !termCovered(term));
  const selected = hits.slice(0, limit);
  const result = {
    goal,
    relatedTerms: relatedTerms ?? [],
    total: selected.length,
    candidates: selected.map((hit) => {
      const entry: CatalogEntry = hit.entry;
      const source = catalog.sources[entry.source];
      const services = (entry.services ?? [
        { type: ServiceType.Wfs, endpoint: entry.endpoint, typeName: entry.typeName },
      ]).map((service) => ({
        type: service.type,
        endpoint: service.endpoint,
        typeName: service.typeName,
        capabilitySemantics: CAPABILITY_SEMANTICS[service.type],
      }));
      return {
        typeName: entry.typeName,
        title: entry.title,
        source: entry.source,
        score: Math.round(hit.score * 100) / 100,
        rationale: rationale(hit),
        services,
        flags: layerFlags(entry, catalog.sources),
        evidence: {
          verifiedAt: entry.verifiedAt,
          sourceStatus: source?.status ?? null,
          fetchedAt: source?.fetchedAt ?? null,
          licenseStatus: endpointById(entry.source).license.status,
        },
      };
    }),
    noCoverage,
    ...(noCoverage.length > 0
      ? {
          hint: `No layer metadata mentions: ${noCoverage.join(', ')}. The search is lexical: retry adding synonyms or English/technical equivalents in relatedTerms (e.g. for "focos de calor": "incendio", "fire", "hotspot", "MODIS").`,
        }
      : {}),
  };
  if (selected.length === 0) {
    return {
      ...result,
      message:
        goalTerms.length === 0
          ? 'No meaningful goal terms found. Rephrase with concrete layer keywords.'
          : 'No catalog layers match these terms literally. The search is lexical over layer metadata: add synonyms and English/technical equivalents in relatedTerms (e.g. for "focos de calor": "incendio", "fire", "hotspot", "MODIS").',
    };
  }
  return result;
}

export default async function suggest_layers(args: InferSchema<typeof schema>) {
  return asText(await suggestLayersHandler(args));
}
