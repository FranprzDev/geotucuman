/** Verified official WFS/WMS endpoints (last full check 2026-11-07). Do not invent others. */
export interface SourceLicense {
  status: string;
  attribution: string;
  url: string;
}

export interface EndpointConfig {
  id: string;
  label: string;
  /** Official province name (Spanish). National sources use 'Argentina (nacional)'. */
  province: string;
  url: string;
  /**
   * WFS version. Inert for ArcGIS sources (kept required for the shared interface);
   * use the placeholder '1.1.0'.
   */
  wfsVersion: '1.1.0' | '2.0.0';
  /**
   * Pagination parameter name. Inert for ArcGIS sources;
   * use the placeholder 'maxFeatures'.
   */
  countParam: 'maxFeatures' | 'count';
  /** Explicit WMS base when it cannot be derived from the WFS url. */
  wmsUrl?: string;
  /** Source with no WFS: `url` is the WMS base and doubles as the info page. */
  wmsOnly?: boolean;
  /** Several themed WMS services under one source (ArcGIS MapServer pattern). */
  wmsServices?: string[];
  /**
   * ArcGIS REST root + folders that contain FeatureServer services.
   * Only FeatureServer vector layers with the Query capability are indexed.
   */
  arcgis?: {
    root: string;
    folders: string[];
    /**
     * Explicit allowlist of full FeatureServer service names to index (e.g. 'Hosted/Bomberos').
     * When set, discovery is skipped and only these services are fetched/preserved.
     */
    services?: string[];
  };
  /** Source with no WFS and no WMS: only ArcGIS REST (FeatureServer) services. */
  arcgisOnly?: boolean;
  /**
   * Explicit WMS layer allowlist (single exact layer name for INTA sources).
   * When set, only these GetCapabilities layers are indexed and any absent one fails the source.
   */
  wmsLayerAllowlist?: string[];
  /** Partial-coverage caveat appended to each entry abstract and exposed by describe_layer. */
  coverageNote?: string;
  /** Reviewed GetMap probe (CRS + bbox) used by describe_layer and smoke checks. */
  wmsProbe?: { crs: string; bbox: [number, number, number, number] };
  license: SourceLicense;
}

/**
 * Resolves the WMS base URL for a WFS endpoint:
 * explicit wmsUrl wins; '/wfs' suffix maps to '/wms'; '/ows' serves both; otherwise none.
 * ArcGIS-only sources have no WMS base: always returns null.
 */
export function wmsUrlFor(ep: EndpointConfig): string | null {
  if (ep.arcgisOnly) return null;
  if (ep.wmsUrl) return ep.wmsUrl;
  if (ep.url.endsWith('/wfs')) return ep.url.replace(/\/wfs$/, '/wms');
  if (ep.url.endsWith('/ows')) return ep.url;
  return null;
}

/** Shared license text for provincial sources whose services publish no per-layer license. */
function provincialLicense(serviceUrl: string): SourceLicense {
  return {
    status:
      'Organismo publico provincial; el GetCapabilities no publica licencia por capa y no se encontraron terminos de reuso publicados',
    attribution: 'Citar al organismo provincial; condiciones de reuso por capa no publicadas.',
    url: serviceUrl,
  };
}

export const ENDPOINTS: EndpointConfig[] = [
  {
    id: 'geosplan',
    label: 'Sec. de Gestion Publica y Planeamiento (Geosplan), Tucuman',
    province: 'Tucumán',
    url: 'http://g.geosplan.tucuman.gob.ar/geoserver/WFS_GEOSPLAN/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    license: {
      status: 'Terminos del sitio Geosplan: CC BY-NC-SA (Reconocimiento-NoComercial-CompartirIgual)',
      attribution: 'Citar la fuente y la fecha de ultima actualizacion, no alterar el contenido ni su sentido, sin fines comerciales sobre la obra original o la informacion publicada. Terminos a nivel sitio: el servicio WFS no publica licencia por capa.',
      url: 'http://geosplan.tucuman.gob.ar/index.php/institucional/terminos-de-uso/',
    },
  },
  {
    id: 'dgct',
    label: 'Direccion General de Catastro, Tucuman',
    province: 'Tucumán',
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
    province: 'Argentina (nacional)',
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
    province: 'Tucumán',
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
  {
    id: 'caba',
    label: 'Direccion General de Estadistica y Censos (CABA)',
    province: 'Ciudad Autónoma de Buenos Aires',
    url: 'https://ideec.estadisticaciudad.gob.ar/geoserver/ows',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    license: provincialLicense('https://ideec.estadisticaciudad.gob.ar/geoserver/ows'),
  },
  {
    id: 'ideba',
    label: 'Infraestructura de Datos Espaciales de la Provincia de Buenos Aires (IDEBA)',
    province: 'Buenos Aires',
    url: 'https://geoserver.ideba.gba.gob.ar/geoserver/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsUrl: 'https://geoserver.ideba.gba.gob.ar/geoserver/wms',
    license: provincialLicense('https://geoserver.ideba.gba.gob.ar/geoserver/'),
  },
  {
    id: 'idecor',
    label: 'Infraestructura de Datos Espaciales de Cordoba (IDECOR)',
    province: 'Córdoba',
    url: 'https://idecor-ws.mapascordoba.gob.ar/geoserver/idecor/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsUrl: 'https://idecor-ws.mapascordoba.gob.ar/geoserver/idecor/wms',
    license: provincialLicense('https://idecor-ws.mapascordoba.gob.ar/geoserver/idecor/'),
  },
  {
    id: 'entrerios',
    label: 'Infraestructura de Datos Espaciales de Entre Rios',
    province: 'Entre Ríos',
    url: 'https://geoservicios.entrerios.gov.ar/geoserver/ows',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    license: provincialLicense('https://geoservicios.entrerios.gov.ar/geoserver/ows'),
  },
  {
    id: 'idechaco',
    label: 'Infraestructura de Datos Espaciales del Chaco (IDEChaco)',
    province: 'Chaco',
    // Plain HTTP: the HTTPS host geoportal.idechaco.gob.ar refuses connections.
    url: 'http://idechaco.gob.ar/geoserver/idechaco/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    license: provincialLicense('http://idechaco.gob.ar/geoserver/idechaco/'),
  },
  {
    id: 'idejuy',
    label: 'Infraestructura de Datos Espaciales de Jujuy (IDEJuy)',
    province: 'Jujuy',
    url: 'https://geo.idejuy.jujuy.gob.ar/geoserver/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsUrl: 'https://geo.idejuy.jujuy.gob.ar/geoserver/wms',
    license: provincialLicense('https://geo.idejuy.jujuy.gob.ar/geoserver/'),
  },
  {
    id: 'misiones',
    label: 'Direccion Provincial de Vialidad (Misiones)',
    province: 'Misiones',
    url: 'https://sigvial.dpvmisiones.gob.ar/geoserver/ows',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    license: provincialLicense('https://sigvial.dpvmisiones.gob.ar/geoserver/ows'),
  },
  {
    id: 'neuquen',
    label: 'Direccion Provincial de Catastro e Informacion Territorial (Neuquen)',
    province: 'Neuquén',
    url: 'https://catastro.neuquen.gov.ar/nqn_ide/services/IDE/Catastro/MapServer/WMSServer',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsOnly: true,
    license: provincialLicense('https://catastro.neuquen.gov.ar/nqn_ide/services/IDE/Catastro/MapServer'),
  },
  {
    id: 'idern',
    label: 'Infraestructura de Datos Espaciales de Rio Negro (IDERN)',
    province: 'Río Negro',
    url: 'https://idern.rionegro.gov.ar/geoserver/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsUrl: 'https://idern.rionegro.gov.ar/geoserver/wms',
    license: provincialLicense('https://idern.rionegro.gov.ar/geoserver/'),
  },
  {
    id: 'salta',
    label: 'Infraestructura de Datos Espaciales de Salta',
    province: 'Salta',
    url: 'https://geoportal.salta.gob.ar/geoserver/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsUrl: 'https://geoportal.salta.gob.ar/geoserver/wms',
    license: provincialLicense('https://geoportal.salta.gob.ar/geoserver/'),
  },
  {
    id: 'sanjuan',
    label: 'Infraestructura de Datos Espaciales de San Juan (UNIDE)',
    province: 'San Juan',
    url: 'https://unide.sanjuan.gob.ar/geoserver/wms',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsOnly: true,
    license: provincialLicense('https://unide.sanjuan.gob.ar/geoserver/'),
  },
  {
    id: 'sanluis',
    label: 'Direccion Provincial de Catastro y Tierras Fiscales (San Luis)',
    province: 'San Luis',
    url: 'http://visualcatsl.dyndns.info/geoserver/SanLuis/wfs',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsUrl: 'http://visualcatsl.dyndns.info/geoserver/SanLuis/wms',
    license: provincialLicense('http://visualcatsl.dyndns.info/geoserver/SanLuis/'),
  },
  {
    id: 'santacruz',
    label: 'Sistema de Informacion Territorial Unico (Santa Cruz)',
    province: 'Santa Cruz',
    url: 'https://situ.santacruz.gob.ar/geoserver/ows',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    license: provincialLicense('https://situ.santacruz.gob.ar/geoserver/ows'),
  },
  {
    id: 'tdf',
    label: 'Infraestructura de Datos Espaciales de Tierra del Fuego',
    province: 'Tierra del Fuego',
    url: 'https://tiles.tierradelfuego.gob.ar/geoserver/ows',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    license: provincialLicense('https://tiles.tierradelfuego.gob.ar/geoserver/ows'),
  },
  {
    id: 'mendoza',
    label: 'Infraestructura de Datos Espaciales de Mendoza (IDE Mendoza)',
    province: 'Mendoza',
    // ArcGIS-only source: root + folders are the discovery surface. wfsVersion/countParam
    // are inert placeholders required by the shared interface.
    url: 'https://ide.mendoza.gov.ar/server/rest/services',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    arcgis: {
      root: 'https://ide.mendoza.gov.ar/server/rest/services',
      folders: ['Hosted'],
      // Reviewed public-environment/infrastructure schemas only. This is NOT the full
      // 'Hosted' folder: any other Hosted service is intentionally left out of scope.
      services: [
        'Hosted/Bomberos',
        'Hosted/Departamentos_2024',
        'Hosted/Bosques_Nativos_',
        'Hosted/Cuencas_Hidrográficas',
        'Hosted/Suelos',
        'Hosted/Inventario_Nacional_Glaciares_IANIGLA',
        'Hosted/Rutas_de_Mendoza_IGN',
        'Hosted/aridez_pasado_vect',
        'Hosted/aridez_futuro_vect',
      ],
    },
    arcgisOnly: true,
    license: {
      status: 'El servicio no declara licencia ni terminos de reuso publicados',
      attribution: 'Citar al organismo provincial (IDE Mendoza); condiciones de reuso no publicadas',
      url: 'https://ide.mendoza.gov.ar/server/rest/services',
    },
  },
  {
    id: 'inta_santiago',
    label: 'INTA - Suelos de Santiago del Estero',
    province: 'Santiago del Estero',
    url: 'https://geo-nodo02.inta.gob.ar/geoserver/wms',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsOnly: true,
    wmsLayerAllowlist: ['geonode:suelos'],
    wmsProbe: { crs: 'EPSG:4326', bbox: [-65.181, -30.48, -61.707, -25.651] },
    coverageNote:
      'Fuente oficial INTA (nodo02), tematica regional de suelos; no es IDE provincial ni cubre todos los temas. Capa de suelos de Santiago del Estero, escala 1:500000. Unica capa revisada y permitida en este endpoint.',
    license: {
      status: 'No especificada por el autor en metadatos',
      attribution:
        'INTA; Angueira C. 2007. Mapa de suelos de Santiago del Estero. Escala 1:500000. Reuso no autorizado por inferencia.',
      url: 'https://geo-nodo02.inta.gob.ar/showmetadata/xsl/8',
    },
  },
  {
    id: 'inta_catamarca',
    label: 'INTA - Suelos de Catamarca',
    province: 'Catamarca',
    url: 'https://geo-nodo11.inta.gob.ar/geoserver/wms',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsOnly: true,
    wmsLayerAllowlist: ['geonode:suelocatamarca_1_500'],
    wmsProbe: { crs: 'EPSG:4326', bbox: [-69.096, -30.12, -64.78, -25.168] },
    coverageNote:
      'Fuente oficial INTA (nodo11), tematica regional de suelos; no es IDE provincial ni cubre todos los temas. Capa de suelos de Catamarca, escala 1:500000. Unica capa revisada y permitida en este endpoint.',
    license: {
      status: 'Dominio publico (PD), declarado en metadatos',
      attribution: 'INTA. Mapa de suelos de Catamarca. Escala 1:500000.',
      url: 'https://geo-nodo11.inta.gob.ar/showmetadata/xsl/21',
    },
  },
  {
    id: 'inta_larioja',
    label: 'INTA - Cobertura de Suelos de La Rioja',
    province: 'La Rioja',
    url: 'https://geo-nodo11.inta.gob.ar/geoserver/wms',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsOnly: true,
    wmsLayerAllowlist: ['geonode:lccs_n3_2007_lr_c01bf1947b73120dcc56d9b76907d712'],
    wmsProbe: { crs: 'EPSG:4326', bbox: [-69.64, -32, -65.42, -27.7] },
    coverageNote:
      'Fuente oficial INTA (nodo11), tematica regional de cobertura; no es IDE provincial ni cubre todos los temas. Cobertura de suelo historica 2006-2007 (LCCS FAO), recorte provincial, no es cobertura actual. Unica capa revisada y permitida en este endpoint.',
    license: {
      status: 'Dominio publico (PD), declarado en metadatos',
      attribution:
        'INTA. Cobertura de suelo La Rioja 2006-2007 (LCCS FAO), recorte provincial. Cobertura historica, no actual.',
      url: 'https://geo-nodo11.inta.gob.ar/catalogue/csw?request=GetRecordById&service=CSW&version=2.0.2&id=35c8b3cd-7d96-45ec-adf8-a2b3f315b039&outputschema=http%3A%2F%2Fwww.isotc211.org%2F2005%2Fgmd&elementsetname=full',
    },
  },
  {
    id: 'inta_corrientes',
    label: 'INTA - Lomas Arenosas de Corrientes',
    province: 'Corrientes',
    url: 'https://geo-nodo09.inta.gob.ar/geoserver/wms',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsOnly: true,
    wmsLayerAllowlist: ['geonode:Lomas_arenosas'],
    wmsProbe: { crs: 'EPSG:4326', bbox: [-59.122, -29.025, -57.151, -27.483] },
    coverageNote:
      'Fuente oficial INTA (nodo09), tematica regional; no es IDE provincial ni cubre todos los temas. Solo el area cartografiada de Lomas Arenosas (1:100000), no la provincia completa. Unica capa revisada y permitida en este endpoint.',
    license: {
      status: 'Dominio publico (PD), declarado en metadatos',
      attribution:
        'Ligier, H.D. et al. Evaluacion de Tierras para Cultivo de Cana de Azucar en Corrientes. INTA. EEA Corrientes. RRNN. 2014.',
      url: 'https://geo-nodo09.inta.gob.ar/showmetadata/xsl/251',
    },
  },
  {
    id: 'inta_santafe',
    label: 'INTA - Capacidad Productiva de Santa Fe',
    province: 'Santa Fe',
    url: 'https://geo-nodo10.inta.gob.ar/geoserver/wms',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsOnly: true,
    wmsLayerAllowlist: ['geonode:cpa_santa_fe'],
    wmsProbe: { crs: 'EPSG:4326', bbox: [-62.884, -34.388, -58.832, -27.996] },
    coverageNote:
      'Fuente oficial INTA (nodo10), tematica regional de capacidad productiva (alfalfa); no es IDE provincial ni cubre todos los temas. Capa INTA de capacidad productiva agricola para alfalfa, escala 1:250000. Unica capa revisada y permitida en este endpoint.',
    license: {
      status: 'Dominio publico (PD), declarado en metadatos',
      attribution: 'INTA. Capacidad productiva agricola (alfalfa) Santa Fe. Escala 1:250000.',
      url: 'https://geo-nodo10.inta.gob.ar/catalogue/csw?request=GetRecordById&service=CSW&version=2.0.2&id=8003225d-276c-48d1-bf84-af3f0c02320d&outputschema=http%3A%2F%2Fwww.isotc211.org%2F2005%2Fgmd&elementsetname=full',
    },
  },
  {
    id: 'inta_chubut',
    label: 'INTA - Unidades de Paisaje Patagonia Sur (Chubut)',
    province: 'Chubut',
    url: 'https://geo-nodo06.inta.gob.ar/geoserver/wms',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsOnly: true,
    wmsLayerAllowlist: ['geonode:psur_unidades_paisaje_3857'],
    wmsProbe: { crs: 'EPSG:4326', bbox: [-71, -46, -65, -42] },
    coverageNote:
      'Fuente oficial INTA (nodo06), tematica regional; no es IDE provincial ni cubre todos los temas. Unidades de Paisaje Patagonia Sur: incluye Chubut y otras provincias. Capa regional, no recortada a limites provinciales; prueba GetMap realizada dentro de Chubut. Unica capa revisada y permitida en este endpoint.',
    license: {
      status: 'Dominio publico (PD), declarado en metadatos',
      attribution: 'INTA. Unidades de Paisaje Patagonia Sur. Citar fuente INTA.',
      url: 'https://geo-nodo06.inta.gob.ar/showmetadata/xsl/20',
    },
  },
  {
    id: 'inta_lapampa',
    label: 'INTA - Productividad Forrajera de La Pampa',
    province: 'La Pampa',
    url: 'https://geo-nodo15.inta.gob.ar/geoserver/wms',
    wfsVersion: '1.1.0',
    countParam: 'maxFeatures',
    wmsOnly: true,
    wmsLayerAllowlist: ['geonode:productividad_forrajera_la_pampaf78de876da1c'],
    wmsProbe: { crs: 'EPSG:4326', bbox: [-68.295, -39.28, -63.389, -34.998] },
    coverageNote:
      'Fuente oficial INTA (nodo15), tematica regional de productividad forrajera; no es IDE provincial ni cubre todos los temas. INTA PPNA pastizales, modelo 2001-2011 / series 2000-2013, no es tiempo real. Unica capa revisada y permitida en este endpoint.',
    license: {
      status:
        'Metadatos contradictorios: licencia PD y restriccion adicional atribucion-no comercial. Aplicar condicion mas restrictiva (sin uso comercial), no licencia libre confirmada.',
      attribution:
        'INTA. Productividad forrajera PPNA pastizales, modelo 2001-2011 / series 2000-2013. No en tiempo real. Atribucion requerida; sin uso comercial.',
      url: 'https://geo-nodo15.inta.gob.ar/catalogue/csw?request=GetRecordById&service=CSW&version=2.0.2&id=11400a25-9948-4c42-8eec-ee2a3a1de4fd&outputschema=http%3A%2F%2Fwww.isotc211.org%2F2005%2Fgmd&elementsetname=full',
    },
  },
];

export function endpointById(id: string): EndpointConfig {
  const ep = ENDPOINTS.find((e) => e.id === id);
  if (!ep) throw new Error(`Unknown endpoint: ${id}`);
  return ep;
}
