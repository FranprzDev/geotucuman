import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { findLayer } from '../catalog.js';
import { endpointById } from '../endpoints.js';
import { getFeature } from '../wfs.js';
import { epsgCode, reprojectBboxFrom4326 } from '../projection.js';
import { asText, described, truncateGeometry } from '../lib/shared.js';

export const schema = {
  typeName: z.string(),
  maxFeatures: z.number().int().min(1).max(50).default(5),
  startIndex: z.number().int().min(0).optional(),
  bbox: z.array(z.number()).length(4).describe('[minLon, minLat, maxLon, maxLat]').optional(),
  bboxCrs: z.string().describe('CRS del bbox; por defecto EPSG:4326. Se reproyecta al CRS nativo de la capa antes de consultar.').optional(),
};

export const metadata: ToolMetadata = {
  name: 'consultar_capa',
  description:
    'Consulta features de una capa WFS (GetFeature). REQUIERE haber llamado describir_capa antes. Geometrías en EPSG:4326 lon,lat. El bbox se pasa en EPSG:4326 (lon,lat) por defecto y se reproyecta en el cliente al CRS nativo de la capa (verificado: estos servidores devuelven 0 si el bbox va en 4326 sobre capa proyectada).',
};

export default async function consultar_capa({ typeName, maxFeatures, startIndex, bbox, bboxCrs }: InferSchema<typeof schema>) {
  const entry = findLayer(typeName);
  if (!entry) {
    return asText({ error: `Capa no encontrada en el catálogo: ${typeName}. Usá buscar_capas primero.` });
  }
  if (!described.has(entry.typeName.toLowerCase())) {
    return asText({
      error: `Regla describe-antes-de-consultar: llamá describir_capa("${entry.typeName}") primero para conocer los campos reales.`,
    });
  }
  const ep = endpointById(entry.source);
  let nativeBbox: [number, number, number, number] | undefined;
  if (bbox) {
    const fromEpsg = epsgCode(bboxCrs ?? 'EPSG:4326');
    const toEpsg = epsgCode(entry.defaultCrs);
    if (!fromEpsg || !toEpsg) {
      return asText({ error: `No pude interpretar los CRS (bbox: ${bboxCrs ?? 'EPSG:4326'}, capa: ${entry.defaultCrs}).` });
    }
    const raw = bbox as [number, number, number, number];
    if (fromEpsg === '4326') {
      const reproj = reprojectBboxFrom4326(raw, toEpsg);
      if (!reproj) {
        return asText({
          error: `La capa usa EPSG:${toEpsg} y todavía no tengo reproyección para ese CRS. Consultá sin bbox o pedí la capa entera y filtrá vos.`,
        });
      }
      nativeBbox = reproj;
    } else if (fromEpsg === toEpsg) {
      nativeBbox = raw;
    } else {
      return asText({
        error: `bboxCrs=EPSG:${fromEpsg} no soportado: pasá el bbox en EPSG:4326 o en el CRS nativo (EPSG:${toEpsg}).`,
      });
    }
  }
  const fc = await getFeature(ep, entry.typeName, {
    maxFeatures,
    startIndex,
    bbox: nativeBbox,
    bboxCrs: nativeBbox ? `EPSG:${epsgCode(entry.defaultCrs)}` : undefined,
    srsName: 'EPSG:4326',
  });
  const features = (fc.features ?? []).map(truncateGeometry);
  const nextStartIndex = features.length === maxFeatures ? (startIndex ?? 0) + features.length : null;
  return asText({
    typeName: entry.typeName,
    devueltos: features.length,
    totalFeatures: fc.totalFeatures ?? null,
    nextStartIndex,
    features,
    nota: 'Geometrías pedidas en EPSG:4326 (lon,lat). El bbox se reproyectó en el cliente al CRS nativo de la capa. nextStartIndex indica cómo seguir paginando (null si no hay más página evidente).',
    fuentes: [entry.endpoint],
  });
}
