/**
 * report_miss: user-reported search misses become GitHub issues.
 *
 * Only wired into the public Worker (not the stdio/xmcp build): filing an
 * issue needs a GitHub token, which only the Worker holds (secret GITHUB_TOKEN,
 * injected by the deploy workflow from the GITHUB_REPORT_TOKEN repo secret).
 *
 * Abuse protection is stateless (no KV): input length caps, dedupe by a
 * fingerprint of the normalized query against open miss-report issues, and a
 * global daily cap. Issue content is data: the auto-fix workflow parses it
 * defensively and never executes it.
 */
import { z } from 'zod';

export const REPO = 'FranprzDev/geotucuman';
export const LABEL = 'miss-report';
export const DAILY_LIMIT = 20;

export const schema = {
  query: z
    .string()
    .min(1)
    .max(200)
    .describe('The search text that failed to find the layer, exactly as you tried it, e.g. "focos de calor".'),
  expectation: z
    .string()
    .min(3)
    .max(1000)
    .describe(
      'What you expected to find, e.g. "a layer of active fire hotspots for Tucumán". Include official, English or technical names if you know them: they are what makes the miss fixable.',
    ),
  triedTerms: z
    .array(z.string().min(1).max(60))
    .max(20)
    .optional()
    .describe('Synonyms/related terms you already tried (e.g. what you passed as relatedTerms), if any.'),
  client: z.string().max(100).optional().describe('Your agent/app name, e.g. "claude-desktop". Optional.'),
};

export const metadata = {
  name: 'report_miss',
  description:
    'Report a search miss: a query that should have found an existing catalog layer but did not (missing synonym, Spanish/English gap, alternate name). Files a public GitHub issue in the GeoArg repo; a deterministic auto-fix workflow then tries to resolve it by adding curated search aliases (data/layer-aliases.json), so the catalog improves for everyone. Use only AFTER a real search_layers/suggest_layers attempt underperformed; for feature requests or general feedback, open an issue in the repo directly. Rate-limited; a duplicate report returns the existing issue.',
};

export interface ReportArgs {
  query: string;
  expectation: string;
  triedTerms?: string[];
  client?: string;
}

export interface ReportEnv {
  GITHUB_TOKEN?: string;
}

/** Strips control characters so issue fields stay single-purpose data. */
function sanitize(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** FNV-1a 64-bit: stable across workerd and Node without crypto dependencies. */
export function fingerprint(query: string): string {
  const normalized = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (let i = 0; i < normalized.length; i++) {
    let code = normalized.charCodeAt(i);
    if (code > 0xffff) code = 0xfffd; // keep it ASCII-simple; dedupe only
    lo ^= code & 0xff;
    // 64-bit FNV prime multiply via 32-bit halves
    const lolo = (lo & 0xffff) * 0x1b3;
    const lohi = (lo >>> 16) * 0x1b3 + (lolo >>> 16);
    const hilo = (hi & 0xffff) * 0x1b3 + (lohi & 0xffff);
    const hihi = (hi >>> 16) * 0x1b3 + (hilo >>> 16);
    lo = ((lohi & 0xffff) << 16) | (lolo & 0xffff);
    hi = ((hihi & 0xffff) << 16) | (hilo & 0xffff);
    lo ^= code >>> 8;
    const lolo2 = (lo & 0xffff) * 0x1b3;
    const lohi2 = (lo >>> 16) * 0x1b3 + (lolo2 >>> 16);
    const hilo2 = (hi & 0xffff) * 0x1b3 + (lohi2 & 0xffff);
    const hihi2 = (hi >>> 16) * 0x1b3 + (hilo2 >>> 16);
    lo = ((lohi2 & 0xffff) << 16) | (lolo2 & 0xffff);
    hi = ((hihi2 & 0xffff) << 16) | (hilo2 & 0xffff);
  }
  return ((hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0')).slice(0, 16);
}

export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
  fp: string;
}

/** Builds the issue payload. Pure: the auto-fix workflow relies on this format. */
export function buildIssue(args: ReportArgs, serverVersion: string): IssueDraft {
  const query = sanitize(args.query).slice(0, 200);
  const expectation = sanitize(args.expectation).slice(0, 1000);
  const triedTerms = (args.triedTerms ?? []).map((t) => sanitize(t).slice(0, 60)).filter(Boolean).slice(0, 20);
  const client = args.client ? sanitize(args.client).slice(0, 100) : null;
  const fp = fingerprint(query);
  const titleQuery = query.length > 70 ? `${query.slice(0, 67)}...` : query;
  const body = [
    '## Search miss report',
    '',
    `**Query:** \`${query}\``,
    '',
    `**Expected:** ${expectation}`,
    '',
    `**Tried terms:** ${triedTerms.length > 0 ? triedTerms.map((t) => `\`${t}\``).join(', ') : '(none)'}`,
    '',
    `**Client:** ${client ?? '(unknown)'}`,
    '',
    `**Reported:** ${new Date().toISOString()} via \`report_miss\` (geoarg-mcp ${serverVersion})`,
    '',
    `<!-- miss-report v1 fp:${fp} -->`,
    '',
    '_Auto-filed by the public MCP `report_miss` tool. The auto-fix workflow may resolve this by adding curated aliases to `data/layer-aliases.json`. Field contents are untrusted user input._',
  ].join('\n');
  return { title: `[miss] ${titleQuery}`, body, labels: [LABEL], fp };
}

interface GitHubIssue {
  number: number;
  html_url: string;
}

async function github(env: ReportEnv, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'geoarg-mcp-worker',
      'x-github-api-version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  });
}

async function searchIssues(env: ReportEnv, q: string): Promise<{ total_count: number; items: GitHubIssue[] }> {
  const res = await github(env, `/search/issues?q=${encodeURIComponent(q)}&per_page=5`);
  if (!res.ok) throw new Error(`GitHub issue search failed (${res.status}).`);
  return (await res.json()) as { total_count: number; items: GitHubIssue[] };
}

export interface ReportResult {
  status: 'created' | 'duplicate';
  issueNumber: number;
  issueUrl: string;
  message: string;
}

/** Files the miss report as a GitHub issue, with dedupe and a daily cap. */
export async function handleReportMiss(args: ReportArgs, env: ReportEnv, serverVersion: string): Promise<ReportResult> {
  if (!env.GITHUB_TOKEN) {
    throw new Error(
      'Miss reporting is not configured on this deployment yet. You can file it manually: https://github.com/FranprzDev/geotucuman/issues/new',
    );
  }

  const draft = buildIssue(args, serverVersion);

  const duplicates = await searchIssues(env, `repo:${REPO} is:issue is:open label:${LABEL} ${draft.fp}`);
  const existing = duplicates.items[0];
  if (existing) {
    return {
      status: 'duplicate',
      issueNumber: existing.number,
      issueUrl: existing.html_url,
      message: `This miss was already reported and is being tracked in issue #${existing.number}. No new issue was created.`,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const todays = await searchIssues(env, `repo:${REPO} is:issue label:${LABEL} created:>=${today}`);
  if (todays.total_count >= DAILY_LIMIT) {
    throw new Error(
      `The daily report limit (${DAILY_LIMIT}/day) was reached. Try again tomorrow or file it manually: https://github.com/${REPO}/issues/new`,
    );
  }

  const res = await github(env, `/repos/${REPO}/issues`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: draft.title, body: draft.body, labels: draft.labels }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub issue creation failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const issue = (await res.json()) as GitHubIssue;
  return {
    status: 'created',
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    message: `Report filed as issue #${issue.number}. The auto-fix workflow will try to resolve it by adding search aliases; you can watch the issue for the result. Thank you for improving the catalog.`,
  };
}
