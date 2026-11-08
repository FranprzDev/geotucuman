import assert from 'node:assert/strict';

import {
  listArcgisServices,
  getArcgisLayers,
  describeArcgisFields,
  queryArcgis,
} from '../src/arcgis.js';

type FetchCall = { url: string; init?: RequestInit };
type MockHandler = (url: string) => unknown | Promise<unknown>;

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function withMockedFetch<T>(handler: MockHandler, fn: (calls: FetchCall[]) => Promise<T>): Promise<T> {
  const calls: FetchCall[] = [];
  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const body = await handler(url);
    if (body instanceof Response) return body;
    return jsonResponse(body);
  };
  (globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  console.log(`ok - ${name}`);
}

async function main(): Promise<void> {
  await test('listArcgisServices handles prefixed and unprefixed names and excludes MapServer', async () => {
    await withMockedFetch(
      (url) => {
        assert.match(url, /Hosted\?f=json$/);
        return {
          folders: ['Hosted'],
          services: [
            { name: 'Hosted/foo', type: 'FeatureServer' },
            { name: 'bar', type: 'FeatureServer' },
            { name: 'rasterTile', type: 'MapServer' },
            { name: 'Hosted/raster2', type: 'MapServer' },
          ],
        };
      },
      async () => {
        const services = await listArcgisServices('https://example.test/arcgis/rest/services', ['Hosted']);
        assert.deepEqual(services, ['Hosted/foo', 'Hosted/bar']);
      },
    );
  });

  await test('getArcgisLayers supports extent and top-level spatial reference', async () => {
    await withMockedFetch(
      (url) => {
        if (/\/FeatureServer\?f=json$/.test(url)) {
          return {
            layers: [
              { id: 0, name: 'LayerA' },
              { id: 1, name: 'LayerB' },
            ],
            // Service-level spatial reference intentionally omitted to force layer-level lookup.
            description: 'service description',
            copyrightText: 'service copyright',
          };
        }
        if (/\/FeatureServer\/0\?f=json$/.test(url)) {
          return {
            id: 0,
            name: 'LayerA',
            geometryType: 'esriGeometryPoint',
            capabilities: 'Query,Extract',
            // NOTE: legacy top-level spatialReference, kept for reference.
            spatialReference: { wkid: 102100, latestWkid: 3857 },
            // The value under extent.spatialReference is the one that reflects the layer's
            // data CRS as declared in service metadata; the code currently ignores it.
            extent: {
              spatialReference: { wkid: 4326 },
            },
          };
        }
        if (/\/FeatureServer\/1\?f=json$/.test(url)) {
          return {
            id: 1,
            name: 'LayerB',
            geometryType: 'esriGeometryPolygon',
            capabilities: 'Query',
            description: 'layer B description',
            copyrightText: 'layer B copyright',
            extent: {
              spatialReference: { wkid: 4326 },
            },
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      async () => {
        const layers = await getArcgisLayers('https://example.test/arcgis/rest/services', 'Hosted/svc');
        assert.equal(layers.length, 2);
        const a = layers.find((l) => l.id === 0);
        const b = layers.find((l) => l.id === 1);
        assert.ok(a);
        assert.ok(b);
        // These assertions encode the intended behavior: prefer extent.spatialReference.
        assert.equal(a.wkid, 4326, 'layer wkid should come from extent.spatialReference');
        assert.equal(b.wkid, 4326, 'layer wkid should come from extent.spatialReference');
        assert.equal(a.name, 'LayerA');
        assert.equal(a.description, 'service description');
        assert.equal(a.copyrightText, 'service copyright');
        assert.equal(b.description, 'layer B description');
        assert.equal(b.copyrightText, 'layer B copyright');
      },
    );
  });

  await test('describeArcgisFields returns field name/type tuples', async () => {
    await withMockedFetch(
      (url) => {
        assert.match(url, /\/FeatureServer\/3\?f=json$/);
        return {
          fields: [
            { name: 'OBJECTID', type: 'esriFieldTypeOID' },
            { name: 'nombre', type: 'esriFieldTypeString' },
            { name: 'poblacion', type: 'esriFieldTypeInteger' },
          ],
        };
      },
      async () => {
        const fields = await describeArcgisFields('https://example.test/arcgis/rest/services', 'Hosted/svc', 3);
        assert.deepEqual(fields, [
          { name: 'OBJECTID', type: 'esriFieldTypeOID' },
          { name: 'nombre', type: 'esriFieldTypeString' },
          { name: 'poblacion', type: 'esriFieldTypeInteger' },
        ]);
      },
    );
  });

  await test('describeArcgisFields filters out created_user and last_edited_user', async () => {
    await withMockedFetch(
      (url) => {
        assert.match(url, /\/FeatureServer\/3\?f=json$/);
        return {
          fields: [
            { name: 'OBJECTID', type: 'esriFieldTypeOID' },
            { name: 'nombre', type: 'esriFieldTypeString' },
            { name: 'created_user', type: 'esriFieldTypeString' },
            { name: 'last_edited_user', type: 'esriFieldTypeString' },
            { name: 'poblacion', type: 'esriFieldTypeInteger' },
          ],
        };
      },
      async () => {
        const fields = await describeArcgisFields('https://example.test/arcgis/rest/services', 'Hosted/svc', 3);
        assert.deepEqual(fields, [
          { name: 'OBJECTID', type: 'esriFieldTypeOID' },
          { name: 'nombre', type: 'esriFieldTypeString' },
          { name: 'poblacion', type: 'esriFieldTypeInteger' },
        ]);
        const names = fields.map((f) => f.name);
        assert.ok(!names.includes('created_user'));
        assert.ok(!names.includes('last_edited_user'));
      },
    );
  });

  await test('queryArcgis sends outSR=4326, f=geojson, bbox inSR=4326, pagination and count', async () => {
    await withMockedFetch(
      (url) => {
        const parsed = new URL(url);
        if (/\/FeatureServer\/7\?f=json$/.test(url) && parsed.searchParams.get('f') === 'json') {
          // describeArcgisFields metadata call.
          return {
            fields: [
              { name: 'OBJECTID', type: 'esriFieldTypeOID' },
              { name: 'nombre', type: 'esriFieldTypeString' },
              { name: 'poblacion', type: 'esriFieldTypeInteger' },
              { name: 'created_user', type: 'esriFieldTypeString' },
              { name: 'last_edited_user', type: 'esriFieldTypeString' },
            ],
          };
        }
        if (parsed.searchParams.get('returnCountOnly') === 'true') {
          assert.equal(parsed.searchParams.get('f'), 'json');
          assert.equal(parsed.searchParams.get('where'), '1=1');
          assert.equal(parsed.searchParams.get('geometry'), '-65,-27,-64,-26');
          assert.equal(parsed.searchParams.get('inSR'), '4326');
          assert.equal(parsed.searchParams.get('geometryType'), 'esriGeometryEnvelope');
          assert.equal(parsed.searchParams.get('spatialRel'), 'esriSpatialRelIntersects');
          assert.equal(parsed.searchParams.get('outSR'), null);
          return { count: 1234 };
        }
        assert.equal(parsed.searchParams.get('f'), 'geojson');
        assert.equal(parsed.searchParams.get('outSR'), '4326');
        assert.equal(parsed.searchParams.get('inSR'), '4326');
        assert.equal(parsed.searchParams.get('where'), '1=1');
        assert.equal(
          parsed.searchParams.get('outFields'),
          'OBJECTID,nombre,poblacion',
          'outFields should be the named allow-list without audit user fields',
        );
        assert.equal(parsed.searchParams.get('returnGeometry'), 'true');
        assert.equal(parsed.searchParams.get('resultRecordCount'), '50');
        assert.equal(parsed.searchParams.get('resultOffset'), '100');
        assert.equal(parsed.searchParams.get('geometry'), '-65,-27,-64,-26');
        assert.equal(parsed.searchParams.get('geometryType'), 'esriGeometryEnvelope');
        assert.equal(parsed.searchParams.get('spatialRel'), 'esriSpatialRelIntersects');
        return {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                OBJECTID: 1,
                nombre: 'foo',
                poblacion: 100,
                // Simulate a server that ignores outFields and leaks audit fields.
                created_user: 'alice',
                last_edited_user: 'bob',
              },
              geometry: null,
            },
          ],
        };
      },
      async (calls) => {
        const result = await queryArcgis('https://example.test/arcgis/rest/services', 'Hosted/svc', 7, {
          maxFeatures: 50,
          startIndex: 100,
          bbox: [-65, -27, -64, -26],
        });
        assert.equal(result.type, 'FeatureCollection');
        assert.equal(result.features.length, 1);
        assert.equal(result.totalFeatures, 1234);
        // 1 metadata call + 1 features query + 1 count query.
        assert.equal(calls.length, 3, 'expected describe + features + count calls');
        const feature = result.features[0] as { properties: Record<string, unknown> };
        assert.equal(feature.properties.nombre, 'foo');
        assert.ok(!('created_user' in feature.properties), 'created_user must be stripped');
        assert.ok(!('last_edited_user' in feature.properties), 'last_edited_user must be stripped');
      },
    );
  });

  await test('queryArcgis surfaces ArcGIS error bodies', async () => {
    await withMockedFetch(
      (url) => {
        // Metadata call must succeed so the error-body path is reached on the query call.
        if (/\/FeatureServer\/7\?f=json$/.test(url) && !/\/query/.test(url)) {
          return {
            fields: [
              { name: 'OBJECTID', type: 'esriFieldTypeOID' },
              { name: 'nombre', type: 'esriFieldTypeString' },
            ],
          };
        }
        return { error: { code: 499, message: 'Token Required' } };
      },
      async () => {
        await assert.rejects(
          () =>
            queryArcgis('https://example.test/arcgis/rest/services', 'Hosted/svc', 7, {
              bbox: [-65, -27, -64, -26],
            }),
          (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.match(err.message, /ArcGIS error 499: Token Required/);
            return true;
          },
        );
      },
    );
  });

  console.log('All arcgis tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
