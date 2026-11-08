import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { findLayer } from '../catalog.js';
import type { CatalogEntry, CatalogService } from '../catalog.js';
import { endpointById } from '../endpoints.js';
import { describeFeatureType } from '../wfs.js';
import { describeArcgisFields } from '../arcgis.js';
import { probeWmsGetMap } from '../wms.js';
import { layerFlags } from '../lib/flags.js';
import { loadCatalog } from '../catalog.js';
import { asText, described } from '../lib/shared.js';
import { ServiceType } from '../service-type.js';

const TUCUMAN_ENVELOPE: [number, number, number, number] = [-65.9, -28.6, -64.6, -25.9];

const DGCT_COVERAGE_NOTE =
  'capabilities bbox is the Argentine default extent, not the real provincial coverage';

const PROBE_NOTE = 'A single on-demand probe is not an availability contract.';

export const schema = {
  typeName: z.string().describe('E.g. dgct:parcelas'),
  probeWms: z
    .boolean()
    .optional()
    .describe('Probe the layer with one on-demand WMS GetMap request. Default false.'),
};

export const metadata: ToolMetadata = {
  name: 'describe_layer',
  description:
    'Describe the real fields of a WFS or ArcGIS REST layer (DescribeFeatureType / FeatureServer layer metadata) + catalog metadata. Required before query_layer.',
};

function declaredCrsOf(entry: CatalogEntry, services: CatalogService[]): string[] {
  const crs = new Set<string>();
  for (const svc of services) {
    for (const value of svc.crs ?? []) {
      if (value) crs.add(value);
    }
  }
  return crs.size > 0 ? [...crs] : [entry.defaultCrs];
}

function queryableSummaryOf(services: CatalogService[]) {
  return services.map((svc) => ({
    type: svc.type,
    typeName: svc.typeName,
    queryable: svc.type === ServiceType.Wfs || svc.type === ServiceType.ArcGis ? true : svc.queryable ?? false,
  }));
}

function coverageNoteOf(source: CatalogEntry['source']): string | null {
  const ep = endpointById(source);
  if (ep.coverageNote) return ep.coverageNote;
  return source === 'dgct' ? DGCT_COVERAGE_NOTE : null;
}

export interface DescribeLayerArgs {
  typeName: string;
  probeWms?: boolean;
}

export async function describeLayerHandler({ typeName, probeWms = false }: DescribeLayerArgs) {
  const entry = findLayer(typeName);
  if (!entry) {
    return { error: `Layer not found in catalog: ${typeName}. Use search_layers first.` };
  }
  const services = entry.services ?? [{ type: ServiceType.Wfs, endpoint: entry.endpoint, typeName: entry.typeName }];
  const flags = layerFlags(entry, loadCatalog().sources);
  const declaredCrs = declaredCrsOf(entry, services);
  const queryable = queryableSummaryOf(services);
  const coverage = coverageNoteOf(entry.source);
  const wms = services.find((svc) => svc.type === ServiceType.Wms);
  const configuredProbe = endpointById(entry.source).wmsProbe;
  const probe =
    probeWms && wms
      ? await probeWmsGetMap(
          wms.endpoint,
          wms.typeName,
          configuredProbe?.crs ?? (declaredCrs[0] && declaredCrs[0] !== 'unknown' ? declaredCrs[0] : 'EPSG:4326'),
          configuredProbe?.bbox ?? wms.extent ?? TUCUMAN_ENVELOPE,
        )
      : null;
  const probeFields = probe ? { probe, probeNote: PROBE_NOTE } : {};
  const wfs = services.find((svc) => svc.type === ServiceType.Wfs);
  const arcgis = services.find((svc) => svc.type === ServiceType.ArcGis);
  if (!wfs && !arcgis) {
    return {
      typeName: entry.typeName,
      title: entry.title,
      abstract: entry.abstract || null,
      source: entry.source,
      endpoint: entry.endpoint,
      defaultCrs: entry.defaultCrs,
      fields: null,
      services,
      flags,
      queryable,
      declaredCrs,
      coverage,
      ...probeFields,
      license: endpointById(entry.source).license,
      sources: [entry.endpoint],
      note: 'WMS-only layer: display/context imagery, no vector GetFeature. query_layer does not apply; request the map image from its WMS endpoint.',
    };
  }
  const ep = endpointById(entry.source);
  if (arcgis && ep.arcgis) {
    const m = /^(.*\/FeatureServer)\/(\d+)$/.exec(arcgis.endpoint);
    if (!m) {
      return { error: `ArcGIS endpoint not parseable for ${entry.typeName}: ${arcgis.endpoint}` };
    }
    const layerId = Number(m[2]);
    const serviceName = entry.typeName.replace(/\/\d+$/, '');
    const fields = await describeArcgisFields(ep.arcgis.root, serviceName, layerId);
    described.add(entry.typeName.toLowerCase());
    return {
      typeName: entry.typeName,
      title: entry.title,
      abstract: entry.abstract || null,
      source: entry.source,
      endpoint: entry.endpoint,
      defaultCrs: entry.defaultCrs,
      fields,
      services,
      flags,
      queryable,
      declaredCrs,
      coverage,
      ...probeFields,
      license: ep.license,
      sources: [entry.endpoint],
    };
  }
  if (!wfs) {
    return { error: `Layer ${entry.typeName} is WMS-only.` };
  }
  const fields = await describeFeatureType(ep, wfs.typeName);
  described.add(entry.typeName.toLowerCase());
  return {
    typeName: entry.typeName,
    title: entry.title,
    abstract: entry.abstract || null,
    source: entry.source,
    endpoint: entry.endpoint,
    defaultCrs: entry.defaultCrs,
    fields,
    services,
    flags,
    queryable,
    declaredCrs,
    coverage,
    ...probeFields,
    license: ep.license,
    sources: [entry.endpoint],
  };
}

export default async function describe_layer(args: InferSchema<typeof schema>) {
  return asText(await describeLayerHandler(args));
}
