/**
 * Validates data/catalog.json against the Catalog contract.
 * Exits 1 with the full list of violations; prints per-source layer counts on success.
 */
import { readFileSync } from 'node:fs';

const CATALOG_PATH = 'data/catalog.json';
const REQUIRED_LAYER_FIELDS = ['source', 'province', 'typeName', 'title', 'endpoint'] as const;
const VALID_SERVICE_TYPES = new Set(['wms', 'wfs', 'arcgis']);
const VALID_STATUS = new Set(['live', 'preserved']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function fail(errors: string[]): never {
  console.error(`\ndata/catalog.json validation FAILED with ${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));
} catch (err) {
  console.error(`${CATALOG_PATH} could not be read/parsed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

if (!isPlainObject(raw)) {
  console.error(`${CATALOG_PATH} must contain a JSON object`);
  process.exit(1);
}

const errors: string[] = [];

const sourceRecord = raw.sources;
if (!isPlainObject(sourceRecord)) errors.push('"sources" must be an object');
if (!Array.isArray(raw.layers)) errors.push('"layers" must be an array');
if (errors.length > 0) fail(errors);

const layers = raw.layers as unknown[];
if (layers.length === 0) errors.push('"layers" must not be empty');

const validSourceIds = new Set<string>();
for (const [id, value] of Object.entries(sourceRecord as Record<string, unknown>)) {
  if (!isPlainObject(value)) {
    errors.push(`sources.${id}: must be an object`);
    continue;
  }
  validSourceIds.add(id);
  if (typeof value.status !== 'string' || !VALID_STATUS.has(value.status)) {
    errors.push(`sources.${id}: invalid status ${JSON.stringify(value.status)} (expected "live" or "preserved")`);
  }
  if (!isNonEmptyString(value.fetchedAt)) {
    errors.push(`sources.${id}: "fetchedAt" must be a non-empty string`);
  }
}

const seenIds = new Map<string, number>();
const layerCountBySource = new Map<string, number>();

layers.forEach((entry, i) => {
  const at = `layers[${i}]`;
  if (!isPlainObject(entry)) {
    errors.push(`${at}: must be an object`);
    return;
  }
  const layer = entry;

  for (const field of REQUIRED_LAYER_FIELDS) {
    if (!isNonEmptyString(layer[field])) {
      errors.push(`${at}: required field "${field}" must be a non-empty string`);
    }
  }

  const id = layer.id;
  if (!isNonEmptyString(id)) {
    errors.push(`${at}: "id" must be a non-empty string`);
  }

  const source = layer.source;
  const typeName = layer.typeName;
  if (isNonEmptyString(id)) {
    if (seenIds.has(id)) {
      errors.push(`${at}: duplicate layer id ${JSON.stringify(id)} (first seen at layers[${seenIds.get(id)}])`);
    } else {
      seenIds.set(id, i);
    }
    if (isNonEmptyString(source) && isNonEmptyString(typeName) && id !== `${source}:${typeName}`) {
      errors.push(`${at}: id ${JSON.stringify(id)} must equal "source:typeName" (${source}:${typeName})`);
    }
  }

  if (isNonEmptyString(source)) {
    if (!validSourceIds.has(source)) {
      errors.push(`${at}: source ${JSON.stringify(source)} is not present in the "sources" record`);
    }
    layerCountBySource.set(source, (layerCountBySource.get(source) ?? 0) + 1);
  }

  if (isNonEmptyString(layer.endpoint) && !isValidHttpUrl(layer.endpoint)) {
    errors.push(`${at}: "endpoint" is not a valid http(s) URL: ${JSON.stringify(layer.endpoint)}`);
  }

  if (typeof layer.verifiedAt !== 'string' || !DATE_RE.test(layer.verifiedAt)) {
    errors.push(`${at}: "verifiedAt" must match YYYY-MM-DD, got ${JSON.stringify(layer.verifiedAt)}`);
  } else if (Number.isNaN(Date.parse(layer.verifiedAt))) {
    errors.push(`${at}: "verifiedAt" is not a valid calendar date: ${JSON.stringify(layer.verifiedAt)}`);
  }

  const services = layer.services;
  if (!Array.isArray(services) || services.length === 0) {
    errors.push(`${at}: "services" must be a non-empty array`);
    return;
  }
  services.forEach((service, j) => {
    const sat = `${at}.services[${j}]`;
    if (!isPlainObject(service)) {
      errors.push(`${sat}: must be an object`);
      return;
    }
    if (typeof service.type !== 'string' || !VALID_SERVICE_TYPES.has(service.type)) {
      errors.push(`${sat}: "type" must be one of wms|wfs|arcgis, got ${JSON.stringify(service.type)}`);
    }
    if (!isNonEmptyString(service.endpoint)) {
      errors.push(`${sat}: "endpoint" must be a non-empty string`);
    } else if (!isValidHttpUrl(service.endpoint)) {
      errors.push(`${sat}: "endpoint" is not a valid http(s) URL: ${JSON.stringify(service.endpoint)}`);
    }
    if (!isNonEmptyString(service.typeName)) {
      errors.push(`${sat}: "typeName" must be a non-empty string`);
    }
  });
});

console.log('Per-source layer counts:');
for (const id of Object.keys(sourceRecord as Record<string, unknown>)) {
  console.log(`  ${id}: ${layerCountBySource.get(id) ?? 0}`);
}
console.log(`Total layers: ${layers.length}`);

if (errors.length > 0) fail(errors);
console.log('data/catalog.json is valid.');
