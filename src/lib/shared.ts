/** Anti-hallucination rule (borrowed from GeoContext/IGN France): a layer is not
 *  queried without describing it first in this session, to avoid inventing fields. */
export const described = new Set<string>();

const MAX_GEOMETRY_CHARS = 4000;

export function truncateGeometry(feature: Record<string, unknown>): Record<string, unknown> {
  const geom = feature.geometry;
  if (!geom) return feature;
  const s = JSON.stringify(geom);
  if (s.length <= MAX_GEOMETRY_CHARS) return feature;
  return {
    ...feature,
    geometry: {
      truncated: true,
      bbox: feature.bbox ?? null,
      note: `Geometry omitted due to size (${s.length} chars). Request it with fewer features or filter more.`,
    },
  };
}

export function asText(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}
