/** Endpoints WFS oficiales verificados (29-30/10/2026). No inventar otros. */
export interface SourceLicense {
  status: string;
  attribution: string;
  url: string;
}

export interface EndpointConfig {
  id: 'geosplan' | 'dgct' | 'ign';
  label: string;
  url: string;
  wfsVersion: '1.1.0' | '2.0.0';
  /** 1.1.0 usa maxFeatures, 2.0.0 usa count */
  countParam: 'maxFeatures' | 'count';
  license: SourceLicense;
}

export const ENDPOINTS: EndpointConfig[] = [
  {
    id: 'geosplan',
    label: 'Sec. de Gestion Publica y Planeamiento (Geosplan), Tucuman',
    url: 'http://g.geosplan.tucuman.gob.ar/geoserver/WFS_GEOSPLAN/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    license: {
      status: 'CC BY-NC-SA (Reconocimiento-NoComercial-CompartirIgual) segun los terminos de uso de Geosplan',
      attribution: 'Citar la fuente (Geosplan, Sec. Gestion Publica y Planeamiento, Tucuman), mencionar la fecha de ultima actualizacion, no alterar el contenido ni su sentido, sin fines comerciales sobre la obra original',
      url: 'http://geosplan.tucuman.gov.ar/index.php/institucional/terminos-de-uso/',
    },
  },
  {
    id: 'dgct',
    label: 'Direccion General de Catastro, Tucuman',
    url: 'http://200.49.89.203/geoserver/dgct/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    license: {
      status: 'Sin licencia explicita publicada; servicio documentado como experimental desde 2012',
      attribution: 'Citar a la Direccion General de Catastro de Tucuman y confirmar condiciones de reuso antes de redistribuir',
      url: 'https://catastrotucuman.gov.ar/gestiones/servicio-wms-wfs/',
    },
  },
  {
    id: 'ign',
    label: 'Instituto Geografico Nacional, Argentina',
    url: 'https://wms.ign.gob.ar/geoserver/ows',
    wfsVersion: '2.0.0',
    countParam: 'count',
    license: {
      status: 'Terminos IGN: atribucion obligatoria, compartir libre y gratuito; uso comercial solo en obras derivadas donde la informacion es insumo de un producto nuevo',
      attribution: 'Reconocer la autoria del Instituto Geografico Nacional de la Republica Argentina',
      url: 'https://www.ign.gob.ar/descargas/tyc1.html',
    },
  },
];

export function endpointById(id: string): EndpointConfig {
  const ep = ENDPOINTS.find((e) => e.id === id);
  if (!ep) throw new Error(`Endpoint desconocido: ${id}`);
  return ep;
}
