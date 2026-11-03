import { z } from 'zod';
import type { InferSchema, ToolMetadata } from 'xmcp';
import { findLayer } from '../catalog.js';
import { endpointById } from '../endpoints.js';
import { describeFeatureType } from '../wfs.js';
import { asText, described } from '../lib/shared.js';

export const schema = {
  typeName: z.string().describe('E.g. dgct:parcelas'),
};

export const metadata: ToolMetadata = {
  name: 'describe_layer',
  description:
    'Describe the real fields of a layer (DescribeFeatureType) + catalog metadata. Required before query_layer.',
};

export async function describeLayerHandler({ typeName }: InferSchema<typeof schema>) {
  const entry = findLayer(typeName);
  if (!entry) {
    return { error: `Layer not found in catalog: ${typeName}. Use search_layers first.` };
  }
  const ep = endpointById(entry.source);
  const fields = await describeFeatureType(ep, entry.typeName);
  described.add(entry.typeName.toLowerCase());
  return {
    typeName: entry.typeName,
    title: entry.title,
    abstract: entry.abstract || null,
    source: entry.source,
    endpoint: entry.endpoint,
    defaultCrs: entry.defaultCrs,
    fields,
    license: ep.license,
    sources: [entry.endpoint],
  };
}

export default async function describe_layer(args: InferSchema<typeof schema>) {
  return asText(await describeLayerHandler(args));
}
