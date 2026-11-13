/**
 * Auto-fix driver for miss reports. Runs in the fix-miss GitHub workflow on
 * issues labeled `miss-report` (created by the public MCP's report_miss tool).
 *
 * Flow: parse the report -> reproduce the miss with the catalog search engine
 * -> selectFix() (src/lib/autofix.ts) -> either:
 *   - fix:      add the reported terms to data/layer-aliases.json for the
 *               confident layer(s), verify the original query now finds them,
 *               open a PR, wait for validate to pass, merge it, comment.
 *   - triage:   comment the diagnostics and label `needs-triage`.
 *   - not-a-miss: the query already matches the expected layer; say so.
 *
 * Security: the issue body is untrusted input. It is parsed with strict
 * regexes and length caps; terms written to the repo are normalized
 * alphanumeric tokens (meaningfulTerms); git/gh go through execFileSync with
 * argument arrays, never shell strings; nothing from the body is executed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { searchCatalog, resetSearchEngine } from '../src/search.js';
import { primeCatalog } from '../src/catalog.js';
import type { Catalog, LayerAliases } from '../src/catalog.js';
import { selectFix, aliasTerms, parseReport } from '../src/lib/autofix.js';
import type { ScoredLayer } from '../src/lib/autofix.js';

const REPO = process.env.GH_REPO ?? 'FranprzDev/geotucuman';
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
const ISSUE_NUMBER = Number(process.argv.find((_, i, a) => a[i - 1] === '--issue') ?? process.env.ISSUE_NUMBER);
const ALIASES_PATH = 'data/layer-aliases.json';
const LABELS = { report: 'miss-report', triage: 'needs-triage', fixed: 'auto-fixed', notAMiss: 'not-a-miss' } as const;

if (!TOKEN) {
  console.error('GH_TOKEN is required');
  process.exit(1);
}
if (!Number.isInteger(ISSUE_NUMBER) || ISSUE_NUMBER <= 0) {
  console.error('Usage: tsx scripts/fix-miss.ts --issue <number>');
  process.exit(1);
}

interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: Array<{ name: string }>;
  html_url: string;
}

async function ghApi(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'geoarg-autofix',
      'x-github-api-version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  });
}

async function ghJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await ghApi(path, init);
  if (!res.ok) throw new Error(`GitHub ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/** Ensures a label exists (422 = already exists). Colors are fixed per label. */
async function ensureLabel(name: string, color: string, description: string): Promise<void> {
  const res = await ghApi(`/repos/${REPO}/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, color, description }),
  });
  if (!res.ok && res.status !== 422) throw new Error(`label ${name}: ${res.status}`);
}

async function addLabels(issue: number, labels: string[]): Promise<void> {
  await ghJson(`/repos/${REPO}/issues/${issue}/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ labels }),
  });
}

async function comment(issue: number, body: string): Promise<void> {
  await ghJson(`/repos/${REPO}/issues/${issue}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

function toScored(hits: Array<{ entry: { id: string; source: string }; score: number }>): ScoredLayer[] {
  return hits.map((h) => ({ id: h.entry.id, source: h.entry.source, score: h.score }));
}

function readAliases(): { note: string; aliases: LayerAliases } {
  return JSON.parse(readFileSync(ALIASES_PATH, 'utf-8')) as { note: string; aliases: LayerAliases };
}

/** Merges terms into the alias map: sorted ids, sorted deduped terms. */
function mergeAliases(aliases: LayerAliases, additions: Map<string, string[]>): LayerAliases {
  const out: LayerAliases = {};
  for (const id of Object.keys(aliases)) out[id] = [...aliases[id]];
  for (const [id, terms] of additions) {
    out[id] = [...new Set([...(out[id] ?? []), ...terms])].sort();
  }
  const sorted: LayerAliases = {};
  for (const id of Object.keys(out).sort()) sorted[id] = out[id];
  return sorted;
}

/** In-memory check: with the merged aliases, does the original query now find a fixed layer? */
function verifyFix(catalog: Catalog, merged: LayerAliases, query: string, fixedIds: Set<string>): boolean {
  primeCatalog(structuredClone(catalog), merged);
  resetSearchEngine();
  const hits = searchCatalog(query, { limit: 10 });
  return hits.some((h) => fixedIds.has(h.entry.id));
}

function fmtCandidates(cands: ScoredLayer[]): string {
  if (cands.length === 0) return '(none)';
  return cands.map((c) => `\`${c.id}\` (score ${c.score.toFixed(1)})`).join(', ');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- main ---

const issue = await ghJson<Issue>(`/repos/${REPO}/issues/${ISSUE_NUMBER}`);
const labelNames = new Set(issue.labels.map((l) => l.name));
console.log(`Issue #${issue.number}: ${issue.title} [${[...labelNames].join(', ')}]`);

if (!labelNames.has(LABELS.report)) {
  console.log('No miss-report label; nothing to do.');
  process.exit(0);
}
if (labelNames.has(LABELS.fixed) || labelNames.has(LABELS.triage) || labelNames.has(LABELS.notAMiss)) {
  console.log('Already processed; skipping.');
  process.exit(0);
}

await ensureLabel(LABELS.triage, 'd4c5f9', 'Miss report that needs manual triage');
await ensureLabel(LABELS.fixed, '0e8a16', 'Miss report fixed automatically with search aliases');
await ensureLabel(LABELS.notAMiss, 'c5def5', 'Reported miss that the search already covers');

const report = issue.body ? parseReport(issue.body) : null;
if (!report) {
  await addLabels(ISSUE_NUMBER, [LABELS.triage]);
  await comment(
    ISSUE_NUMBER,
    'I could not parse this as a `report_miss` report (expected **Query:** and **Expected:** fields). Leaving it for manual triage.',
  );
  process.exit(0);
}
console.log(`Report: query="${report.query}" expectation="${report.expectation}" tried=[${report.triedTerms.join(', ')}]`);

const original = toScored(searchCatalog(report.query, { limit: 20 }));
const expansion = toScored(searchCatalog([report.expectation, ...report.triedTerms].join(' '), { limit: 10 }));
const decision = selectFix(original, expansion);
console.log(`Decision: ${decision.kind}`);

if (decision.kind === 'not-a-miss') {
  await addLabels(ISSUE_NUMBER, [LABELS.notAMiss]);
  await comment(
    ISSUE_NUMBER,
    `The query \`${report.query}\` already matches what the report expected: ${fmtCandidates(decision.matches.slice(0, 5))}.\n\n` +
      'No alias needed. If the miss persists for you, add the exact tool call that failed.',
  );
  process.exit(0);
}

if (decision.kind === 'triage') {
  await addLabels(ISSUE_NUMBER, [LABELS.triage]);
  await comment(
    ISSUE_NUMBER,
    `Automatic fix skipped: **${decision.reason}**.\n\n` +
      `What \`${report.query}\` matches today: ${fmtCandidates(original.slice(0, 5))}\n\n` +
      `What the expectation/tried terms match: ${fmtCandidates(decision.candidates)}\n\n` +
      'A human can resolve this by editing `data/layer-aliases.json` by hand.',
  );
  process.exit(0);
}

// decision.kind === 'fix'
const terms = aliasTerms(report.query, report.triedTerms);
if (terms.length === 0) {
  await addLabels(ISSUE_NUMBER, [LABELS.triage]);
  await comment(ISSUE_NUMBER, 'Automatic fix skipped: the report has no meaningful terms to use as aliases. Leaving it for manual triage.');
  process.exit(0);
}
const fixedIds = new Set(decision.layers.map((l) => l.id));
const additions = new Map(decision.layers.map((l) => [l.id, terms]));
const { note, aliases } = readAliases();
const merged = mergeAliases(aliases, additions);

const rawCatalog = JSON.parse(readFileSync('data/catalog.json', 'utf-8')) as Catalog;
if (!verifyFix(rawCatalog, merged, report.query, fixedIds)) {
  await addLabels(ISSUE_NUMBER, [LABELS.triage]);
  await comment(
    ISSUE_NUMBER,
    `Automatic fix skipped: adding ${terms.map((t) => `\`${t}\``).join(', ')} to ${fmtCandidates(decision.layers)} did not make \`${report.query}\` find them. Leaving it for manual triage.`,
  );
  process.exit(0);
}
console.log(`Verified: "${report.query}" finds the fixed layers with the new aliases.`);

writeFileSync(ALIASES_PATH, `${JSON.stringify({ note, aliases: merged }, null, 2)}\n`);

sh('npm', ['run', 'validate-catalog', '--silent']);
sh('npx', ['tsx', 'scripts/search-test.ts']);
console.log('validate-catalog and search-test pass with the new aliases.');

const branch = `auto/miss-${ISSUE_NUMBER}`;
sh('git', ['config', 'user.name', 'Francisco Miguel Perez']);
sh('git', ['config', 'user.email', '112534083+FranprzDev@users.noreply.github.com']);
sh('git', ['checkout', '-B', branch]);
sh('git', ['add', ALIASES_PATH]);
sh('git', ['commit', '-m', `fix(search): alias [${terms.join(', ')}] for miss report #${ISSUE_NUMBER}`]);
sh('git', ['push', '--force-with-lease', '-u', 'origin', branch]);

const termList = terms.map((t) => `\`${t}\``).join(', ');
const layerList = decision.layers.map((l) => `\`${l.id}\``).join(', ');
const prBody = [
  `## What changes`,
  `Adds the search aliases ${termList} to ${layerList} in \`data/layer-aliases.json\`.`,
  '',
  `## Why`,
  `Fixes #${ISSUE_NUMBER} (miss report from the public MCP's \`report_miss\`): the query \`${report.query}\` did not find ${layerList}, even though the layer exists.`,
  '',
  '## Confidence',
  `The reported query matched nothing relevant, and the expectation/tried terms matched this ${decision.layers.length > 1 ? `${decision.layers.length}-layer series from one source` : 'single layer'} far above every other candidate (deterministic gate in \`src/lib/autofix.ts\`). Verified: with these aliases, \`${report.query}\` returns the layer(s) in the top 10.`,
  '',
  '_Opened and, once `validate` is green, merged by the fix-miss workflow._',
].join('\n');

let prUrl = sh('gh', ['pr', 'list', '--repo', REPO, '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url']);
if (!prUrl) {
  prUrl = sh('gh', ['pr', 'create', '--repo', REPO, '--base', 'main', '--head', branch, '--title', `fix(search): aliases for miss report #${ISSUE_NUMBER}`, '--body', prBody]);
}
console.log(`PR: ${prUrl}`);
// PRs opened with the workflow token do not start checks by themselves.
sh('gh', ['workflow', 'run', 'validate.yml', '--repo', REPO, '--ref', branch]);

// Wait for validate on the branch (up to ~20 minutes).
let conclusion = '';
for (let waited = 0; waited < 20 * 60; waited += 20) {
  await sleep(20_000);
  const runs = sh('gh', ['run', 'list', '--repo', REPO, '--workflow', 'validate.yml', '--branch', branch, '--json', 'status,conclusion', '--limit', '1']);
  const latest = (JSON.parse(runs) as Array<{ status: string; conclusion: string | null }>)[0];
  if (latest?.status === 'completed') {
    conclusion = latest.conclusion ?? '';
    break;
  }
}

if (conclusion !== 'success') {
  await addLabels(ISSUE_NUMBER, [LABELS.triage]);
  await comment(ISSUE_NUMBER, `The auto-fix PR ${prUrl} did not get a green \`validate\` run (result: ${conclusion || 'timeout'}). Leaving the PR open for manual review.`);
  console.log(`validate conclusion: ${conclusion || 'timeout'}; left open for review.`);
  process.exit(0);
}

sh('gh', ['pr', 'merge', prUrl, '--repo', REPO, '--merge', '--delete-branch']);
await addLabels(ISSUE_NUMBER, [LABELS.fixed]);
await comment(
  ISSUE_NUMBER,
  `Fixed automatically in ${prUrl} (merged): ${layerList} now also answers to ${termList}.\n\n` +
    'The fix goes live on the public MCP with the Worker redeploy on merge (a few minutes). Thanks for the report.',
);
console.log(`Merged ${prUrl}; issue #${ISSUE_NUMBER} labeled auto-fixed.`);
