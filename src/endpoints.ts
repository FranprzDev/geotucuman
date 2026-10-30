/** Endpoints WFS oficiales verificados (29-30/10/2026). No inventar otros. */
export interface EndpointConfig {
  id: 'geosplan' | 'dgct' | 'ign';
  label: string;
  url: string;
  wfsVersion: '1.1.0' | '2.0.0';
  /** 1.1.0 usa maxFeatures, 2.0.0 usa count */
  countParam: 'maxFeatures' | 'count';
}

export const ENDPOINTS: EndpointConfig[] = [
  {
    id: 'geosplan',
    label: 'Sec. de Gestion Publica y Planeamiento (Geosplan), Tucuman',
    url: 'http://g.geosplan.tucuman.gob.ar/geoserver/WFS_GEOSPLAN/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
  },
  {
    id: 'dgct',
    label: 'Direccion General de Catastro, Tucuman',
    url: 'http://200.49.89.203/geoserver/dgct/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
  },
  {
    id: 'ign',
    label: 'Instituto Geografico Nacional, Argentina',
    url: 'https://wms.ign.gob.ar/geoserver/ows',
    wfsVersion: '2.0.0',
    countParam: 'count',
  },
];

export function endpointById(id: string): EndpointConfig {
  const ep = ENDPOINTS.find((e) => e.id === id);
  if (!ep) throw new Error(`Endpoint desconocido: ${id}`);
  return ep;
}
