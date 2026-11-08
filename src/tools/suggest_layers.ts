import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { loadCatalog, normalize } from '../catalog.js';
import { layerFlags } from '../lib/flags.js';
import type { CatalogEntry } from '../catalog.js';
import { endpointById } from '../endpoints.js';
import { ServiceType } from '../service-type.js';
import { STOPWORDS, TOPICS, topicExpansion } from '../topics.js';
import { asText } from '../lib/shared.js';

export const schema = {
  goal: z.string().describe('Free-text intent, Spanish or English, e.g. "quiero armar un mapa de riego y pozos"'),
  serviceType: z.enum([ServiceType.Wfs, ServiceType.Wms, ServiceType.ArcGis]).optional().describe('Filter by service type'),
  limit: z.number().int().min(1).max(20).default(10),
};

export const metadata: ToolMetadata = {
  name: 'suggest_layers',
  description:
    'Deterministically suggests catalog layers from a free-text goal in Spanish or English using keyword and topic expansion (no LLM, no invented layers). Returns scored candidates with rationale, service capabilities and source evidence, plus uncovered goal terms.',
};

const CAPABILITY_SEMANTICS: Record<ServiceType, string> = {
  [ServiceType.Wfs]: 'Analyzable/downloadable vector data (GetFeature)',
  [ServiceType.Wms]: 'Display/context map imagery (GetMap)',
  [ServiceType.ArcGis]: 'Vector data via ArcGIS REST query',
};

function variants(term: string): string[] {
  const list = [term];
  if (term.endsWith('s') && term.length - 1 >= 3) {
    list.push(term.slice(0, -1));
  }
  if (term.endsWith('es') && term.length - 2 >= 3) {
    list.push(term.slice(0, -2));
  }
  return list;
}

function hits(field: string, term: string): boolean {
  return variants(term).some((variant) => field.includes(variant));
}

interface TermMeta {
  goalTerms: Set<string>;
  topics: Set<string>;
}

interface Candidate {
  entry: CatalogEntry;
  score: number;
  goalTerms: Set<string>;
  topics: Set<string>;
  fields: Set<string>;
}

function tokenize(goal: string): string[] {
  return normalize(goal)
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2 && !STOPWORDS.has(term));
}

function buildExpansion(goalTerms: string[]): Map<string, TermMeta> {
  const expanded = new Map<string, TermMeta>();
  const add = (term: string, goalTerm?: string, topic?: string) => {
    const key = normalize(term);
    if (!key) return;
    let meta = expanded.get(key);
    if (!meta) {
      meta = { goalTerms: new Set(), topics: new Set() };
      expanded.set(key, meta);
    }
    if (goalTerm) meta.goalTerms.add(goalTerm);
    if (topic) meta.topics.add(topic);
  };
  for (const term of goalTerms) {
    add(term, term);
  }
  const expansion = topicExpansion(goalTerms);
  for (const [term, topics] of expansion) {
    const own = expanded.get(normalize(term));
    if (own) {
      for (const topic of topics) own.topics.add(topic);
    }
    for (const topic of topics) {
      add(topic, undefined, topic);
      for (const keyword of TOPICS[topic] ?? []) {
        add(keyword, undefined, topic);
      }
    }
  }
  return expanded;
}

function coverageTerms(term: string, expansion: Map<string, string[]>): string[] {
  const terms = new Set<string>(variants(normalize(term)));
  for (const topic of expansion.get(term) ?? []) {
    terms.add(normalize(topic));
    for (const keyword of TOPICS[topic] ?? []) {
      terms.add(normalize(keyword));
    }
  }
  return Array.from(terms);
}

function layerHitsTerm(entry: CatalogEntry, terms: string[]): boolean {
  const hay = [
    normalize(entry.title),
    normalize(entry.typeName),
    normalize(entry.keywords.join(' ')),
    normalize(entry.abstract),
  ];
  return terms.some((term) => hay.some((field) => hits(field, term)));
}

function rationale(candidate: Candidate): string {
  const goalTerms = Array.from(candidate.goalTerms);
  const topics = Array.from(candidate.topics);
  const fields = Array.from(candidate.fields);
  const parts: string[] = [];
  if (goalTerms.length > 0) {
    parts.push(`goal terms ${goalTerms.map((t) => `"${t}"`).join(', ')}`);
  }
  if (topics.length > 0) {
    parts.push(`topics ${topics.join(', ')}`);
  }
  const match = parts.length > 0 ? `Matched ${parts.join(' via ')}` : 'Matched catalog keywords';
  return fields.length > 0 ? `${match} (${fields.join(', ')}).` : `${match}.`;
}

export async function suggestLayersHandler({ goal, serviceType, limit = 10 }: { goal: string; serviceType?: ServiceType; limit?: number }) {
  const catalog = loadCatalog();
  const goalTerms = Array.from(new Set(tokenize(goal)));
  const expansion = topicExpansion(goalTerms);
  const expanded = buildExpansion(goalTerms);
  const considered = catalog.layers.filter(
    (e) => !serviceType || (e.services ?? []).some((s) => s.type === serviceType),
  );
  const candidates: Candidate[] = [];
  for (const entry of considered) {
    const hay = {
      title: normalize(entry.title),
      typeName: normalize(entry.typeName),
      abstract: normalize(entry.abstract),
      keywords: normalize(entry.keywords.join(' ')),
    };
    let score = 0;
    const matchedGoalTerms = new Set<string>();
    const matchedTopics = new Set<string>();
    const matchedFields = new Set<string>();
    for (const [term, meta] of expanded) {
      const weight = meta.goalTerms.size > 0 ? 1 : 0.5;
      let termHit = false;
      if (hits(hay.title, term)) {
        score += 3 * weight;
        matchedFields.add('title');
        termHit = true;
      }
      if (hits(hay.typeName, term)) {
        score += 2 * weight;
        matchedFields.add('typeName');
        termHit = true;
      }
      if (hits(hay.keywords, term)) {
        score += 2 * weight;
        matchedFields.add('keywords');
        termHit = true;
      }
      if (hits(hay.abstract, term)) {
        score += 1 * weight;
        matchedFields.add('abstract');
        termHit = true;
      }
      if (termHit) {
        for (const goalTerm of meta.goalTerms) matchedGoalTerms.add(goalTerm);
        for (const topic of meta.topics) matchedTopics.add(topic);
      }
    }
    if (score > 0) {
      candidates.push({
        entry,
        score,
        goalTerms: matchedGoalTerms,
        topics: matchedTopics,
        fields: matchedFields,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.entry.typeName.localeCompare(b.entry.typeName));
  const noCoverage = goalTerms.filter(
    (term) => !considered.some((entry) => layerHitsTerm(entry, coverageTerms(term, expansion))),
  );
  const selected = candidates.slice(0, limit);
  const result = {
    goal,
    total: selected.length,
    candidates: selected.map((candidate) => {
      const entry = candidate.entry;
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
        rationale: rationale(candidate),
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
  };
  if (selected.length === 0) {
    return {
      ...result,
      message:
        goalTerms.length === 0
          ? 'No meaningful goal terms found. Rephrase with concrete layer keywords.'
          : 'No catalog layers match this goal. Try rephrasing with more specific terms.',
      availableTopics: Object.keys(TOPICS),
    };
  }
  return result;
}

export default async function suggest_layers(args: InferSchema<typeof schema>) {
  return asText(await suggestLayersHandler(args));
}
