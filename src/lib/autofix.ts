/**
 * Deterministic auto-fix for miss reports (report_miss -> miss-report issue).
 *
 * Given the layers the reported query already matches and the layers the
 * reporter's expectation/related terms match, decides whether the miss can be
 * fixed by adding the reported terms as search aliases (data/layer-aliases.json).
 * Pure functions, no I/O: the workflow driver (scripts/fix-miss.ts) handles
 * GitHub and git, and scripts/autofix-test.ts pins the behavior offline.
 *
 * Safety model: only a unique high-confidence candidate (or a tied series from
 * one source, like the MODIS 24/48/72h/7d fires layers) is fixed automatically;
 * anything ambiguous goes to manual triage. Alias terms are normalized
 * alphanumeric tokens, so a hostile report can at worst add searchable words.
 */
import { meaningfulTerms } from '../search.js';

export interface ScoredLayer {
  id: string;
  source: string;
  score: number;
}

export type FixSelection =
  | { kind: 'fix'; layers: ScoredLayer[] }
  | { kind: 'triage'; reason: string; candidates: ScoredLayer[] }
  | { kind: 'not-a-miss'; matches: ScoredLayer[] };

/** Absolute floor: below this, expansion matches are keyword noise. */
export const MIN_SCORE = 100;
/** The top candidate must beat the next one outside its group by this ratio. */
export const MIN_RATIO = 1.5;
/** Scores within this factor of the top score form the tied "series" group. */
export const GROUP_EPSILON = 0.95;
/** Never auto-fix more layers than this in one report. */
export const MAX_GROUP = 6;
/** Never write more alias terms than this per report. */
export const MAX_TERMS = 10;

/** Alias terms for a report: meaningful tokens of the query plus tried terms. */
export function aliasTerms(query: string, triedTerms: string[] = []): string[] {
  return meaningfulTerms([query, ...triedTerms].join(' ')).slice(0, MAX_TERMS);
}

/**
 * Decides the outcome of a miss report.
 * @param original  Layers the reported query already matches (top N).
 * @param expansion Layers matching the expectation and tried terms (top N).
 */
export function selectFix(original: ScoredLayer[], expansion: ScoredLayer[]): FixSelection {
  const originalIds = new Set(original.map((h) => h.id));
  const topExpansion = expansion[0];
  if (topExpansion && originalIds.has(topExpansion.id)) {
    // The query already finds what the reporter expected: nothing to fix.
    return { kind: 'not-a-miss', matches: expansion.filter((h) => originalIds.has(h.id)) };
  }

  const candidates = expansion.filter((h) => !originalIds.has(h.id) && h.score >= MIN_SCORE);
  if (candidates.length === 0) {
    return { kind: 'triage', reason: 'no candidate above the score floor', candidates: expansion.filter((h) => !originalIds.has(h.id)).slice(0, 5) };
  }

  const top = candidates[0];
  const group = candidates.filter((h) => h.score >= top.score * GROUP_EPSILON && h.source === top.source);
  const outside = candidates.find((h) => !group.includes(h));

  if (group.length > MAX_GROUP) {
    return { kind: 'triage', reason: `tied group too large (${group.length} layers)`, candidates: candidates.slice(0, 5) };
  }
  if (outside && top.score < outside.score * MIN_RATIO) {
    return { kind: 'triage', reason: 'ambiguous: no single high-confidence candidate', candidates: candidates.slice(0, 5) };
  }
  return { kind: 'fix', layers: group };
}

export interface MissReport {
  query: string;
  expectation: string;
  triedTerms: string[];
}

/** Parses the strict issue body format written by worker/report.ts buildIssue(). */
export function parseReport(body: string): MissReport | null {
  const query = /\*\*Query:\*\* `([^`]{1,200})`/.exec(body)?.[1];
  const expectation = /\*\*Expected:\*\* ([^\n]{3,1000})/.exec(body)?.[1]?.trim();
  if (!query || !expectation) return null;
  const triedRaw = /\*\*Tried terms:\*\* ([^\n]*)/.exec(body)?.[1] ?? '';
  const triedTerms = [...triedRaw.matchAll(/`([^`]{1,60})`/g)].map((m) => m[1]).slice(0, 20);
  return { query, expectation, triedTerms };
}
