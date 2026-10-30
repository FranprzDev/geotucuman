export interface ProjectedPoint {
  x: number;
  y: number;
}

const GRS80_A = 6378137;
const GRS80_INV_F = 298.257222101;

interface TmParams {
  lon0: number;
  falseEasting: number;
}

const TM_BY_EPSG: Record<string, TmParams> = {
  '22183': { lon0: -66, falseEasting: 3_500_000 },
  '5345': { lon0: -66, falseEasting: 3_500_000 },
};

export function epsgCode(crs: string | undefined): string | null {
  if (!crs) return null;
  const m = crs.match(/EPSG(?:::*)?(\d+)/i);
  return m ? m[1] : null;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function lonLatToTransverseMercator(lon: number, lat: number, params: TmParams): ProjectedPoint {
  const f = 1 / GRS80_INV_F;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const phi = toRad(lat);
  const lam = toRad(lon);
  const lam0 = toRad(params.lon0);
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const N = GRS80_A / Math.sqrt(1 - e2 * sin * sin);
  const T = tan * tan;
  const C = ep2 * cos * cos;
  const A = (lam - lam0) * cos;
  const M =
    GRS80_A *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const latOrigin = toRad(-90);
  const M0 =
    GRS80_A *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * latOrigin -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latOrigin) +
      ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latOrigin) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latOrigin));
  const x =
    params.falseEasting +
    N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
  const y =
    M -
    M0 +
    N * tan * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720);
  return { x, y };
}

export function projectToEpsg(lon: number, lat: number, epsg: string): ProjectedPoint | null {
  if (epsg === '4326') return { x: lon, y: lat };
  const params = TM_BY_EPSG[epsg];
  if (!params) return null;
  return lonLatToTransverseMercator(lon, lat, params);
}

export function reprojectBboxFrom4326(
  bbox: [number, number, number, number],
  targetEpsg: string,
  samplesPerEdge = 24,
): [number, number, number, number] | null {
  if (targetEpsg === '4326') return bbox;
  if (!TM_BY_EPSG[targetEpsg]) return null;
  const [minX, minY, maxX, maxY] = bbox;
  let outMinX = Infinity;
  let outMinY = Infinity;
  let outMaxX = -Infinity;
  let outMaxY = -Infinity;
  for (let i = 0; i <= samplesPerEdge; i++) {
    const t = i / samplesPerEdge;
    const edgePoints: Array<[number, number]> = [
      [minX + (maxX - minX) * t, minY],
      [minX + (maxX - minX) * t, maxY],
      [minX, minY + (maxY - minY) * t],
      [maxX, minY + (maxY - minY) * t],
    ];
    for (const [lon, lat] of edgePoints) {
      const p = lonLatToTransverseMercator(lon, lat, TM_BY_EPSG[targetEpsg]);
      outMinX = Math.min(outMinX, p.x);
      outMinY = Math.min(outMinY, p.y);
      outMaxX = Math.max(outMaxX, p.x);
      outMaxY = Math.max(outMaxY, p.y);
    }
  }
  return [outMinX, outMinY, outMaxX, outMaxY];
}
