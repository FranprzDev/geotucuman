import { cachedResponse } from './capability-cache.js';
import type { RawCacheTarget } from './capability-cache.js';

const TIMEOUT_MS = 20_000;

const USER_AGENT = 'GeoArg/0.2 (+https://franprzdev.github.io/geotucuman/)';

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    const msg = err instanceof Error && err.name === 'AbortError' ? `timeout>${TIMEOUT_MS}ms` : String(err);
    throw new Error(`WMS request failed (${url.slice(0, 120)}...): ${msg}`);
  } finally {
    clearTimeout(t);
  }
}

export interface WmsLayer {
  name: string;
  title: string;
  abstract: string;
  crs: string[];
  queryable: boolean;
}

function localName(tag: string): string {
  const i = tag.indexOf(':');
  return i === -1 ? tag : tag.slice(i + 1);
}

function parseQueryable(attrs: string, fallback: boolean): boolean {
  const m = /queryable\s*=\s*["']([^"']*)["']/i.exec(attrs);
  if (!m) return fallback;
  const value = m[1].trim().toLowerCase();
  return value === '1' || value === 'true';
}

/** Parses WMS 1.1.1/1.3.0 GetCapabilities without XML dependencies (nested Capability > Layer > Layer[]). */
export function parseWmsCapabilities(xml: string): WmsLayer[] {
  const clean = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  const frames: Array<{ name: string; title: string; abstract: string; crs: string[]; queryable: boolean }> = [];
  const out: WmsLayer[] = [];
  let pending: 'name' | 'title' | 'abstract' | 'crs' | null = null;
  let pendingStart = 0;
  const commit = (text: string) => {
    const frame = frames[frames.length - 1];
    if (!frame || !pending) return;
    const value = text.replace(/<[^>]*>/g, '').trim();
    if (pending === 'crs') {
      if (value) frame.crs.push(value);
    } else if (pending === 'name') {
      if (!frame.name) frame.name = value;
    } else if (pending === 'title') {
      if (!frame.title) frame.title = value;
    } else if (!frame.abstract) {
      frame.abstract = value;
    }
  };
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(clean)) !== null) {
    if (pending) {
      commit(clean.slice(pendingStart, m.index));
      pending = null;
    }
    const closing = m[1] === '/';
    const selfClosing = m[4] === '/';
    const tag = localName(m[2]).toLowerCase();
    if (closing) {
      if (tag === 'layer') {
        const frame = frames.pop();
        if (frame && frame.name) {
          out.push({
            name: frame.name,
            title: frame.title,
            abstract: frame.abstract,
            crs: frame.crs,
            queryable: frame.queryable,
          });
        }
      }
      continue;
    }
    if (tag === 'layer') {
      if (!selfClosing) {
        const parent = frames[frames.length - 1];
        frames.push({
          name: '',
          title: '',
          abstract: '',
          crs: [],
          queryable: parseQueryable(m[3], parent?.queryable ?? false),
        });
      }
      continue;
    }
    if (tag === 'name' || tag === 'title' || tag === 'abstract' || tag === 'crs' || tag === 'srs') {
      if (!selfClosing) {
        pending = tag === 'srs' ? 'crs' : tag;
        pendingStart = tagRe.lastIndex;
      }
    }
  }
  return out;
}

/**
 * Fetches and parses a WMS GetCapabilities. When `cache` is provided the raw XML is read
 * from / written to disk, so offline (`fromCache`) builds are byte-reproducible.
 */
export async function getWmsCapabilities(wmsUrl: string, cache?: RawCacheTarget): Promise<WmsLayer[]> {
  const url = `${wmsUrl}?service=WMS&request=GetCapabilities`;
  const xml = await cachedResponse(cache, () => fetchText(url));
  return parseWmsCapabilities(xml);
}

const PROBE_TIMEOUT_MS = 10_000;

export interface WmsProbe {
  probedAt: string;
  ok: boolean;
  detail: string;
}

export async function probeWmsGetMap(
  wmsUrl: string,
  layerName: string,
  crs: string,
  bbox: [number, number, number, number],
): Promise<WmsProbe> {
  const probedAt = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetMap',
    layers: layerName,
    styles: '',
    format: 'image/png',
    width: '256',
    height: '256',
    srs: crs,
    bbox: bbox.join(','),
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${wmsUrl}?${params.toString()}`, { signal: ctrl.signal });
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    return {
      probedAt,
      ok: res.status === 200 && contentType.startsWith('image/'),
      detail: `HTTP ${res.status}, content-type ${contentType || 'unknown'}`,
    };
  } catch (err) {
    const msg = err instanceof Error && err.name === 'AbortError' ? `timeout>${PROBE_TIMEOUT_MS}ms` : String(err);
    return { probedAt, ok: false, detail: msg };
  } finally {
    clearTimeout(t);
  }
}

export function selectWmsLayers(layers: WmsLayer[], allowlist?: string[]): WmsLayer[] {
  if (allowlist === undefined) return layers;
  if (allowlist.length === 0) {
    throw new Error('WMS layer allowlist is configured but empty');
  }
  const names = new Set(layers.map((w) => w.name));
  const missing = allowlist.filter((n) => !names.has(n));
  if (missing.length > 0) {
    throw new Error(`allowlisted WMS layer(s) absent from GetCapabilities: ${missing.join(', ')}`);
  }
  const allowed = new Set(allowlist);
  return layers.filter((w) => allowed.has(w.name));
}
