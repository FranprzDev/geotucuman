import { appendFileSync, readFileSync } from 'node:fs';

interface SourceHealth {
  ok: number;
  total: number;
}

interface HealthReport {
  checkedAt: string;
  sources: Record<string, SourceHealth>;
}

const HEALTH_PATH = 'data/health.json';
const MIN_HEALTHY_RATIO = 0.9;
const GEOBLOCKED_SOURCES = new Set(['dgct']);

const report = JSON.parse(readFileSync(HEALTH_PATH, 'utf-8')) as HealthReport;

const degraded = Object.entries(report.sources)
  .filter(([id, health]) => !GEOBLOCKED_SOURCES.has(id) && health.total > 0 && health.ok / health.total < MIN_HEALTHY_RATIO)
  .map(([id, health]) => ({ id, ok: health.ok, total: health.total }));

for (const source of degraded) {
  console.log(`${source.id}: ${source.ok}/${source.total} layers healthy`);
}
if (degraded.length === 0) console.log(`No source below ${MIN_HEALTHY_RATIO * 100}% in the ${report.checkedAt} health report`);

const outputPath = process.env.GITHUB_OUTPUT;
if (outputPath) {
  appendFileSync(outputPath, `sources=${degraded.map((s) => s.id).join(',')}\n`);
  appendFileSync(outputPath, `summary=${degraded.map((s) => `${s.id} ${s.ok}/${s.total}`).join(', ')}\n`);
}
