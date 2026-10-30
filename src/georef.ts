const GEOREF = 'https://apis.datos.gob.ar/georef/api';
const TIMEOUT_MS = 15_000;

export interface GeorefHit {
  tipo: string;
  nombre: string;
  provincia?: string;
  departamento?: string;
  lat?: number;
  lon?: number;
  fuente: string;
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
        tipo: key ?? 'desconocido',
        nombre: String(r.nombre ?? ''),
        provincia: typeof r.provincia === 'object' && r.provincia ? String((r.provincia as Record<string, unknown>).nombre) : undefined,
        departamento: typeof r.departamento === 'object' && r.departamento ? String((r.departamento as Record<string, unknown>).nombre) : undefined,
        lat: c.lat,
        lon: c.lon,
        fuente: url,
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/**
 * Geocodifica texto libre con la API Georef (gratis, sin key).
 * Verificado 29/10/2026 con /provincias. El resto de endpoints se prueban aca en vivo.
 */
export async function geocode(texto: string): Promise<GeorefHit[]> {
  const q = texto.trim();
  if (!q) return [];
  // "Yerba Buena, Tucumán": la API no matchea la coma; separamos lugar y provincia.
  const parts = q.split(',').map((p) => p.trim()).filter(Boolean);
  const place = parts[0];
  const provincia = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const base: Record<string, string> = { nombre: place, max: '5' };
  if (provincia) base.provincia = provincia;
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
