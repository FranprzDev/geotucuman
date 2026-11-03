import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { findLayer } from '../catalog.js';
import { endpointById } from '../endpoints.js';
import { getFeature } from '../wfs.js';
import { epsgCode, reprojectBboxFrom4326 } from '../projection.js';
import { asText, described, truncateGeometry } from '../lib/shared.js';
import { ServiceType } from '../service-type.js';

export const schema = {
  typeName: z.string(),
  maxFeatures: z.number().int().min(1).max(50).default(5),
  startIndex: z.number().int().min(0).optional(),
  bbox: z.array(z.number()).length(4).describe('[minLon, minLat, maxLon, maxLat]').optional(),
  bboxCrs: z.string().describe('CRS of the bbox; defaults to EPSG:4326. It is reprojected to the layer native CRS before querying.').optional(),
};

export const metadata: ToolMetadata = {
  name: 'query_layer',
  description:
    'Query features of a WFS layer (GetFeature). REQUIRES having called describe_layer before. Geometries in EPSG:4326 lon,lat. The bbox is passed in EPSG:4326 (lon,lat) by default and reprojected on the client to the layer native CRS (verified: these servers return 0 if the bbox is sent in 4326 over a projected layer).',
};

export async function queryLayerHandler({ typeName, maxFeatures, startIndex, bbox, bboxCrs }: InferSchema<typeof schema>) {
  const entry = findLayer(typeName);
  if (!entry) {
    return { error: `Layer not found in catalog: ${typeName}. Use search_layers first.` };
  }
  const layerServices = entry.services ?? [{ type: ServiceType.Wfs, endpoint: entry.endpoint, typeName: entry.typeName }];
  if (!layerServices.some((svc) => svc.type === ServiceType.Wfs)) {
    return {
      error: `Layer ${entry.typeName} is WMS-only (display imagery). Vector query (GetFeature) does not apply; use describe_layer to see its WMS endpoint.`,
    };
  }
  if (!described.has(entry.typeName.toLowerCase())) {
    return {
      error: `Rule describe-before-query: call describe_layer("${entry.typeName}") first to learn the real fields.`,
    };
  }
  const ep = endpointById(entry.source);
  let nativeBbox: [number, number, number, number] | undefined;
  if (bbox) {
    const fromEpsg = epsgCode(bboxCrs ?? 'EPSG:4326');
    const toEpsg = epsgCode(entry.defaultCrs);
    if (!fromEpsg || !toEpsg) {
      return { error: `Could not interpret the CRS (bbox: ${bboxCrs ?? 'EPSG:4326'}, layer: ${entry.defaultCrs}).` };
    }
    const raw = bbox as [number, number, number, number];
    if (fromEpsg === '4326') {
      const reproj = reprojectBboxFrom4326(raw, toEpsg);
      if (!reproj) {
        return {
          error: `The layer uses EPSG:${toEpsg} and I do not have reprojection for that CRS yet. Query without bbox or request the whole layer and filter yourself.`,
        };
      }
      nativeBbox = reproj;
    } else if (fromEpsg === toEpsg) {
      nativeBbox = raw;
    } else {
      return {
        error: `bboxCrs=EPSG:${fromEpsg} not supported: pass the bbox in EPSG:4326 or in the native CRS (EPSG:${toEpsg}).`,
      };
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
  return {
    typeName: entry.typeName,
    returned: features.length,
    totalFeatures: fc.totalFeatures ?? null,
    nextStartIndex,
    features,
    note: 'Geometries requested in EPSG:4326 (lon,lat). The bbox was reprojected on the client to the layer native CRS. nextStartIndex indicates how to keep paginating (null if there is no obvious next page).',
    sources: [entry.endpoint],
  };
}

export default async function query_layer(args: InferSchema<typeof schema>) {
  return asText(await queryLayerHandler(args));
}
