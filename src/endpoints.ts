/** Verified official WFS endpoints (29-30/10/2026). Do not invent others. */
export interface SourceLicense {
  status: string;
  attribution: string;
  url: string;
}

export interface EndpointConfig {
  id: 'geosplan' | 'dgct' | 'ign' | 'rides';
  label: string;
  url: string;
  wfsVersion: '1.1.0' | '2.0.0';
  /** 1.1.0 uses maxFeatures, 2.0.0 uses count */
  countParam: 'maxFeatures' | 'count';
  wmsServices?: string[];
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
      status: 'Terminos del sitio Geosplan: CC BY-NC-SA (Reconocimiento-NoComercial-CompartirIgual)',
      attribution: 'Citar la fuente y la fecha de ultima actualizacion, no alterar el contenido ni su sentido, sin fines comerciales sobre la obra original o la informacion publicada. Terminos a nivel sitio: el servicio WFS no publica licencia por capa.',
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
      status: 'Sin licencia ni terminos de uso publicados; servicio documentado como experimental desde 2012',
      attribution: 'Citar a la Direccion General de Catastro de Tucuman; las condiciones de reuso no estan publicadas.',
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
      status: 'Terminos IGN para informacion descargada de su sitio: atribucion, compartir libre y gratuito, uso comercial solo en obras derivadas',
      attribution: 'Reconocer la autoria del Instituto Geografico Nacional de la Republica Argentina. El servicio WFS no publica licencia por capa.',
      url: 'https://www.ign.gob.ar/descargas/tyc1.html',
    },
  },
  {
    id: 'rides',
    label: 'Ministerio de Produccion (RIDES), Tucuman',
    url: 'https://rides.producciontucuman.gob.ar/servicios-wms/',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsServices: [
      'https://gis.producciontucuman.gob.ar/ArcGIS/services/Actividades_Agropecuarias_WMS/MapServer/WMSServer',
      'https://gis.producciontucuman.gob.ar/ArcGIS/services/Actividades_Industriales_WMS/MapServer/WMSServer',
      'https://gis.producciontucuman.gob.ar/ArcGIS/services/Infraestructura/MapServer/WMSServer',
      'https://gis.producciontucuman.gob.ar/ArcGIS/services/MST/MapServer/WMSServer',
      'https://gis.producciontucuman.gob.ar/ArcGIS/services/Medio_Ambiente_WMS/MapServer/WMSServer',
      'https://gis.producciontucuman.gob.ar/ArcGIS/services/Recursos_Hidricos_WMS/MapServer/WMSServer',
      'https://gis.producciontucuman.gob.ar/ArcGIS/services/Topografia/MapServer/WMSServer',
      'https://gis.producciontucuman.gob.ar/ArcGIS/services/Tucuman/MapServer/WMSServer',
      'https://gis.producciontucuman.gob.ar/ArcGIS/services/Turismo/MapServer/WMSServer',
    ],
    license: {
      status: 'Organismo publico provincial (Ministerio de Produccion); terminos de licencia por capa no verificados',
      attribution: 'Citar al Ministerio de Produccion de Tucuman (RIDES); condiciones de reuso por capa no publicadas.',
      url: 'https://rides.producciontucuman.gob.ar/servicios-wms/',
    },
  },
];

export function endpointById(id: string): EndpointConfig {
  const ep = ENDPOINTS.find((e) => e.id === id);
  if (!ep) throw new Error(`Unknown endpoint: ${id}`);
  return ep;
}
