import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { loadCatalog } from '../catalog.js';
import { discoveryMetadata } from '../lib/discovery.js';
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
  province: z.string().optional().describe('Filter by province, e.g. "Córdoba"'),
  limit: z.number().int().min(1).max(20).default(5),
  minScore: z.number().finite().nonnegative().default(0),
};

export const metadata: ToolMetadata = {
  name: 'suggest_layers',
  description:
    'Suggests catalog layers from a free-text goal in Spanish or English (no LLM, no invented layers). Ranking is a MiniSearch full-text engine over each layer\'s title, identifier, keywords and abstract - same pattern as IGN France\'s GeoContext - with prefix and bounded fuzzy matching, with Spanish stemming, so word forms and derivations are handled generally. Lexical search cannot bridge languages or concepts by itself: pass synonyms and English/technical equivalents in relatedTerms. Returns ranked, scored candidates with the matched terms as rationale, service capabilities and source evidence, plus goal terms no layer covers (noCoverage). Optional serviceType/province filters apply to both candidates and noCoverage. Use limit (1-20, default 5) to cap candidates and minScore to drop weak lexical matches. noCoverage means literal goal terms unmatched within those filters, not proof that the topic does not exist; relatedTerms are client expansions, not semantic proof. Discovery does not execute spatial or temporal analysis or verify current observations: never infer proximity or current fires from layer names, scores or cached catalog metadata.',
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
  province,
  limit = 5,
  minScore = 0,
}: {
  goal: string;
  relatedTerms?: string[];
  serviceType?: ServiceType;
  province?: string;
  limit?: number;
  minScore?: number;
}) {
  const catalog = loadCatalog();
  const query = [goal, ...(relatedTerms ?? [])].join(' ');
  const hits = searchCatalog(query, { serviceType, province });
  const goalTerms = meaningfulTerms(goal);
  const noCoverage = goalTerms.filter((term) => !termCovered(term, { serviceType, province }));
  const thematicHits = hits.filter((hit) =>
    Object.values(hit.match).some((fields) =>
      fields.some((field) => field !== 'province' && field !== 'source'),
    ),
  );
  const selected = thematicHits.filter((hit) => hit.score >= minScore).slice(0, limit);
  const discoveryStatus = selected.length === 0 ? 'no_match' : noCoverage.length > 0 ? 'partial' : 'candidates';
  const groupedBySource = Object.fromEntries(
    [...new Set(selected.map((hit) => hit.entry.source))].map((source) => [
      source,
      selected.filter((hit) => hit.entry.source === source).map((hit) => hit.entry.typeName),
    ]),
  );
  const result = {
    goal,
    relatedTerms: relatedTerms ?? [],
    serviceType: serviceType ?? null,
    province: province ?? null,
    minScore,
    total: selected.length,
    discoveryStatus,
    answerability: {
      canAnswerQuestion: false,
      reason:
        'This tool only discovers catalog layers; it does not execute spatial or temporal analysis or verify current observations. Other GeoArg tools may query data.',
    },
    candidates: selected.map((hit, index) => {
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
        rank: index + 1,
        typeName: entry.typeName,
        title: entry.title,
        source: entry.source,
        province: entry.province,
        score: hit.score,
        rationale: rationale(hit),
        services,
        flags: layerFlags(entry, catalog.sources),
        evidence: {
          verifiedAt: entry.verifiedAt,
          sourceStatus: source?.status ?? null,
          fetchedAt: source?.fetchedAt ?? null,
          licenseStatus: endpointById(entry.source).license.status,
        },
        ...discoveryMetadata(entry, catalog.sources),
      };
    }),
    groupedBySource,
    noCoverage,
    noCoverageNote:
      'noCoverage lists literal goal terms unmatched within the serviceType/province filters; it is not proof that the topic does not exist. relatedTerms are client-provided expansions, not semantic proof.',
    disclaimer:
      'Do not infer proximity or current fires from layer names, scores or cached catalog metadata; validate with describe_layer/query_layer and live data.',
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
