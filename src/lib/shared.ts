/** Regla anti-alucinacion (prestada de GeoContext/IGN Francia): no se consulta
 *  una capa sin describirla antes en esta sesion, para no inventar campos. */
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
      truncada: true,
      bbox: feature.bbox ?? null,
      nota: `Geometria omitida por tamano (${s.length} chars). Pedila con menos features o filtra mas.`,
    },
  };
}

export function asText(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}
