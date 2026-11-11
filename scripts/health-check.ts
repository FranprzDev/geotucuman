/**
 * Per-layer health monitor. Probes every declared service of every catalog layer and
 * writes data/health.json plus an append-only data/health-history.jsonl.
 *
 * Flags:
 *   --sample N     probe only N random layers
 *   --source <id>  probe only layers of one source
 *   --out <path>   output path for the report (default data/health.json)
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadCatalog } from '../src/catalog.js';
import type { Catalog, CatalogEntry, CatalogService } from '../src/catalog.js';
import { endpointById } from '../src/endpoints.js';
import { getFeature } from '../src/wfs.js';
import { probeWmsGetMap } from '../src/wms.js';
import { ServiceType } from '../src/service-type.js';

const USER_AGENT = 'GeoArg/0.2 (+https://franprzdev.github.io/geotucuman/)';
const NATIONAL_ENVELOPE: [number, number, number, number] = [-73.6, -55.0, -53.6, -21.8];
/** Global cap of in-flight requests and per-endpoint-host cap to stay polite. */
const GLOBAL_LIMIT = 8;
const PER_HOST_LIMIT = 2;
const RETRY_DELAY_MS = 2000;
const PROBE_TIMEOUT_MS = 20_000;
const HISTORY_PATH = 'data/health-history.jsonl';

type TypeKey = 'wms' | 'wfs' | 'arcgis';

interface Outcome {
  ok: boolean;
  ms: number;
  detail: string;
}

interface LayerHealth {
  wms?: Outcome;
  wfs?: Outcome;
  arcgis?: Outcome;
}

interface SourceHealth {
  ok: number;
  total: number;
  avgMs: number;
  failedLayerIds: string[];
}

interface HealthReport {
  checkedAt: string;
  durationMs: number;
  totals: {
    layers: number;
    layersOk: number;
    layersFailed: number;
    probes: number;
    probesOk: number;
    avgMs: number;
  };
  sources: Record<string, SourceHealth>;
  layers: Record<string, LayerHealth>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when a failure looks like a network/timeout problem worth one retry. */
function looksLikeNetworkFailure(detail: string): boolean {
  return /timeout|timed out|fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|abort|UND_ERR/i.test(detail);
}

function shorten(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Same declared-CRS selection as describeLayerHandler. */
function declaredCrsOf(entry: CatalogEntry): string[] {
  const crs = new Set<string>();
  for (const svc of entry.services ?? []) {
    for (const value of svc.crs ?? []) {
      if (value) crs.add(value);
    }
  }
  return crs.size > 0 ? [...crs] : [entry.defaultCrs];
}

async function probeWms(entry: CatalogEntry, svc: CatalogService): Promise<Outcome> {
  const t0 = Date.now();
  const configured = endpointById(entry.source).wmsProbe;
  const declared = declaredCrsOf(entry);
  const crs = configured?.crs ?? (declared[0] && declared[0] !== 'unknown' ? declared[0] : 'EPSG:4326');
  const bbox = configured?.bbox ?? svc.extent ?? NATIONAL_ENVELOPE;
  let probe = await probeWmsGetMap(svc.endpoint, svc.typeName, crs, bbox);
  if (!probe.ok && looksLikeNetworkFailure(probe.detail)) {
    await delay(RETRY_DELAY_MS);
    probe = await probeWmsGetMap(svc.endpoint, svc.typeName, crs, bbox);
  }
  return { ok: probe.ok, ms: Date.now() - t0, detail: probe.detail };
}

async function probeWfs(entry: CatalogEntry): Promise<Outcome> {
  const t0 = Date.now();
  const ep = endpointById(entry.source);
  const attempt = async (): Promise<void> => {
    const fc = await getFeature(ep, entry.typeName, { maxFeatures: 1, srsName: 'EPSG:4326' });
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
      throw new Error('response is not a GeoJSON FeatureCollection');
    }
  };
  try {
    await attempt();
    return { ok: true, ms: Date.now() - t0, detail: 'FeatureCollection' };
  } catch (err) {
    if (looksLikeNetworkFailure(String(err))) {
      await delay(RETRY_DELAY_MS);
      try {
        await attempt();
        return { ok: true, ms: Date.now() - t0, detail: 'FeatureCollection (retry)' };
      } catch (err2) {
        return { ok: false, ms: Date.now() - t0, detail: shorten(err2) };
      }
    }
    return { ok: false, ms: Date.now() - t0, detail: shorten(err) };
  }
}

/** Minimal ArcGIS REST query probe: where=1=1, one record, f=json. */
async function probeArcgis(svc: CatalogService): Promise<Outcome> {
  const t0 = Date.now();
  const base = svc.endpoint.replace(/\/+$/, '');
  const url = `${base}/query?where=${encodeURIComponent('1=1')}&resultRecordCount=1&f=json&returnGeometry=false`;
  const attempt = async (): Promise<void> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { error?: { code?: number; message?: string }; features?: unknown[] };
      if (body && typeof body === 'object' && body.error) {
        throw new Error(`ArcGIS error ${body.error.code ?? ''}: ${body.error.message ?? 'unknown'}`.trim());
      }
      if (!Array.isArray(body.features)) throw new Error('response has no features array');
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await attempt();
    return { ok: true, ms: Date.now() - t0, detail: 'query ok' };
  } catch (err) {
    if (looksLikeNetworkFailure(String(err))) {
      await delay(RETRY_DELAY_MS);
      try {
        await attempt();
        return { ok: true, ms: Date.now() - t0, detail: 'query ok (retry)' };
      } catch (err2) {
        return { ok: false, ms: Date.now() - t0, detail: shorten(err2) };
      }
    }
    return { ok: false, ms: Date.now() - t0, detail: shorten(err) };
  }
}

interface Job {
  host: string;
  run: () => Promise<void>;
}

/** Runs jobs with a global pool and a per-host cap, preserving completion accounting. */
async function runPool(jobs: Job[]): Promise<void> {
  const pending = [...jobs];
  const activeHost = new Map<string, number>();
  let running = 0;
  await new Promise<void>((resolve) => {
    const pump = (): void => {
      while (running < GLOBAL_LIMIT) {
        const i = pending.findIndex((j) => (activeHost.get(j.host) ?? 0) < PER_HOST_LIMIT);
        if (i === -1) break;
        const job = pending.splice(i, 1)[0];
        running++;
        activeHost.set(job.host, (activeHost.get(job.host) ?? 0) + 1);
        job
          .run()
          .catch(() => undefined)
          .finally(() => {
            running--;
            activeHost.set(job.host, (activeHost.get(job.host) ?? 0) - 1);
            pump();
          });
      }
      if (running === 0 && pending.length === 0) resolve();
    };
    pump();
  });
}

function mergeOutcomes(list: Outcome[]): Outcome {
  if (list.length === 1) return list[0];
  const ok = list.every((o) => o.ok);
  const ms = list.reduce((acc, o) => acc + o.ms, 0);
  const detail = ok
    ? 'ok'
    : list
        .filter((o) => !o.ok)
        .map((o) => o.detail)
        .join(' | ')
        .slice(0, 300);
  return { ok, ms, detail };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function readArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function servicesOf(entry: CatalogEntry): CatalogService[] {
  const services = entry.services ?? [];
  if (services.length > 0) return services;
  return [{ type: ServiceType.Wfs, endpoint: entry.endpoint, typeName: entry.typeName }];
}

async function main(): Promise<number> {
  const started = Date.now();
  const sampleArg = readArg('--sample');
  const sourceArg = readArg('--source');
  const outPath = readArg('--out') ?? 'data/health.json';

  let catalog: Catalog;
  try {
    catalog = loadCatalog();
  } catch (err) {
    console.error(`No se pudo leer el catalogo: ${shorten(err)}`);
    return 1;
  }

  let entries = catalog.layers;
  if (sourceArg) entries = entries.filter((l) => l.source === sourceArg);
  const sample = sampleArg !== undefined ? Number(sampleArg) : undefined;
  const sampleSize = sample !== undefined && Number.isFinite(sample) ? Math.floor(sample) : undefined;
  if (sampleSize !== undefined && sampleSize > 0 && sampleSize < entries.length) {
    entries = shuffle(entries).slice(0, sampleSize);
  }

  const raw = new Map<string, Partial<Record<TypeKey, Outcome[]>>>();
  const jobs: Job[] = [];
  for (const entry of entries) {
    const perLayer: Partial<Record<TypeKey, Outcome[]>> = {};
    raw.set(entry.id, perLayer);
    for (const svc of servicesOf(entry)) {
      if (svc.type === ServiceType.Wms) {
        const arr = (perLayer.wms ??= []);
        jobs.push({ host: hostOf(svc.endpoint), run: async () => { arr.push(await probeWms(entry, svc)); } });
      } else if (svc.type === ServiceType.Wfs) {
        const arr = (perLayer.wfs ??= []);
        jobs.push({ host: hostOf(entry.endpoint), run: async () => { arr.push(await probeWfs(entry)); } });
      } else if (svc.type === ServiceType.ArcGis) {
        const arr = (perLayer.arcgis ??= []);
        jobs.push({ host: hostOf(svc.endpoint), run: async () => { arr.push(await probeArcgis(svc)); } });
      }
    }
  }

  await runPool(jobs);

  const layersOut: Record<string, LayerHealth> = {};
  const sourceAgg = new Map<string, { layers: number; ok: number; msSum: number; failed: string[] }>();
  let probes = 0;
  let probesOk = 0;
  let probeMs = 0;
  let layersOk = 0;

  for (const entry of entries) {
    const perLayer = raw.get(entry.id) ?? {};
    const out: LayerHealth = {};
    let layerMs = 0;
    let layerOk = true;
    let hasProbe = false;
    for (const kind of ['wms', 'wfs', 'arcgis'] as TypeKey[]) {
      const list = perLayer[kind];
      if (!list || list.length === 0) continue;
      hasProbe = true;
      for (const o of list) {
        probes++;
        probeMs += o.ms;
        if (o.ok) probesOk++;
      }
      const merged = mergeOutcomes(list);
      out[kind] = merged;
      layerMs += merged.ms;
      if (!merged.ok) layerOk = false;
    }
    if (!hasProbe) layerOk = true;
    layersOut[entry.id] = out;
    if (layerOk) layersOk++;
    const agg = sourceAgg.get(entry.source) ?? { layers: 0, ok: 0, msSum: 0, failed: [] };
    agg.layers++;
    agg.msSum += layerMs;
    if (layerOk) agg.ok++;
    else agg.failed.push(entry.id);
    sourceAgg.set(entry.source, agg);
  }

  const sourcesOut: Record<string, SourceHealth> = {};
  let sourcesDown = 0;
  let probedSources = 0;
  let respondedSources = 0;
  for (const [id, agg] of sourceAgg) {
    probedSources++;
    if (agg.ok > 0) respondedSources++;
    if (agg.ok === 0) sourcesDown++;
    sourcesOut[id] = {
      ok: agg.ok,
      total: agg.layers,
      avgMs: agg.layers > 0 ? Math.round(agg.msSum / agg.layers) : 0,
      failedLayerIds: agg.failed,
    };
  }

  const totals = {
    layers: entries.length,
    layersOk,
    layersFailed: entries.length - layersOk,
    probes,
    probesOk,
    avgMs: probes > 0 ? Math.round(probeMs / probes) : 0,
  };

  const report: HealthReport = {
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    totals,
    sources: sourcesOut,
    layers: layersOut,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  mkdirSync(dirname(HISTORY_PATH), { recursive: true });
  appendFileSync(
    HISTORY_PATH,
    `${JSON.stringify({
      date: report.checkedAt.slice(0, 10),
      layers: totals.layers,
      layersOk: totals.layersOk,
      probes: totals.probes,
      probesOk: totals.probesOk,
      sourcesDown,
    })}\n`,
  );

  console.log(`Salud de capas ${report.checkedAt} (${report.durationMs} ms)`);
  console.log(`  Capas: ${totals.layersOk} ok / ${totals.layers} (${totals.layersFailed} con fallas)`);
  console.log(`  Sondeos: ${totals.probesOk} ok / ${totals.probes}`);
  console.log(`  Latencia media: ${totals.avgMs} ms`);
  console.log(`  Fuentes: ${probedSources}, caidas: ${sourcesDown}`);
  console.log(`  Reporte: ${outPath} | historial: ${HISTORY_PATH}`);

  // Less than half the probed sources responding is treated as a systemic failure.
  // Single-source runs are exempt: one down source is data, not a system-wide outage.
  if (probedSources >= 2 && respondedSources * 2 < probedSources) {
    console.error(`Falla sistemica: solo ${respondedSources} de ${probedSources} fuentes responden.`);
    return 1;
  }
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
