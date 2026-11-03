const GEOREF = 'https://apis.datos.gob.ar/georef/api';
const TIMEOUT_MS = 15_000;

export interface GeorefHit {
  type: string;
  name: string;
  province?: string;
  department?: string;
  lat?: number;
  lon?: number;
  source: string;
}

async function georefGet(path: string, params: Record<string, string>): Promise<GeorefHit[]> {
  const qs = new URLSearchParams(params).toString();
  const url = `${GEOREF}${path}?${qs}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, Array<Record<string, unknown>>>;
    const key = Object.keys(data).find((k) => Array.isArray(data[k]) && !['cantidad', 'total', 'inicio', 'parametros'].includes(k));
    const rows = key ? data[key] : [];
    return rows.map((r) => {
      const c = (r.centroide ?? {}) as Record<string, number>;
      return {
        type: key ?? 'unknown',
        name: String(r.nombre ?? ''),
        province: typeof r.provincia === 'object' && r.provincia ? String((r.provincia as Record<string, unknown>).nombre) : undefined,
        department: typeof r.departamento === 'object' && r.departamento ? String((r.departamento as Record<string, unknown>).nombre) : undefined,
        lat: c.lat,
        lon: c.lon,
        source: url,
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/**
 * Geocodes free text with the Georef API (free, no key).
 * Verified 29/10/2026 with /provincias. The other endpoints are tested live here.
 */
export async function geocode(text: string): Promise<GeorefHit[]> {
  const q = text.trim();
  if (!q) return [];
  // "Yerba Buena, Tucumán": the API does not match the comma; split place and province.
  const parts = q.split(',').map((p) => p.trim()).filter(Boolean);
  const place = parts[0];
  const province = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const base: Record<string, string> = { nombre: place, max: '5' };
  if (province) base.provincia = province;
  const tries: Array<[string, Record<string, string>]> = [
    ['/localidades', base],
    ['/municipios', base],
    ['/departamentos', base],
    ['/provincias', { nombre: place, max: '5' }],
  ];
  const out: GeorefHit[] = [];
  for (const [path, params] of tries) {
    const hits = await georefGet(path, params);
    out.push(...hits);
    if (out.length >= 5) break;
  }
  return out.slice(0, 5);
}
