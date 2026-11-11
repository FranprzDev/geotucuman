# GeoArg

MCP (Model Context Protocol) de **descubrimiento y consulta de geodatos públicos**. Corre local por stdio con tu cliente (Claude Code, etc.). El catálogo cubre el IGN nacional, la API Georef y fuentes oficiales de 23 jurisdicciones subnacionales, incluidas 7 fuentes INTA WMS-only integradas y probadas en vivo (detalle abajo; 26 fuentes configuradas de capas (25 subnacionales + IGN; 25 URLs de servicio distintas, porque Catamarca y La Rioja comparten nodo11), más la API Georef; 23 jurisdicciones subnacionales, con 3 fuentes de Tucumán).

> Antes **GeoTucumán**; renombrado a **GeoMCP** el 4/11/2026 y a **GeoArg** el 7/11/2026. El repositorio y la URL pública no cambian.

**Qué es:** una capa de descubrimiento y consulta sobre servicios oficiales WFS, WMS y ArcGIS REST (FeatureServer), más la API Georef.
**Qué NO es:** un SIG completo, ni un visor, ni una copia de los datos. Consulta en vivo y cita la fuente.

## Herramientas

| Tool | Qué hace |
| --- | --- |
| `search_layers` | Busca capas por palabra clave en el catálogo embebido (filtro opcional por tipo de servicio WFS/WMS/ArcGIS) |
| `suggest_layers` | Sugiere capas a partir de un objetivo en texto libre (determinista, sin LLM) |
| `describe_layer` | Campos reales de una capa (obligatorio antes de consultar) |
| `query_layer` | GetFeature con filtros, paginación y bbox en EPSG:4326 (se reproyecta al CRS nativo de la capa en el cliente) |
| `geocode` | Texto libre a coordenadas vía API Georef (gratis, sin key) |

Las capas WMS-only se buscan y describen igual (metadatos vía GetCapabilities); `query_layer` aplica a capas WFS y ArcGIS REST (`serviceType: arcgis`, con describe/query/paginación/bbox/filtro por servicio).

## Cómo usarlo

Requisitos: Node.js y npm.

1. Clonar e instalar dependencias:

   ```bash
   git clone https://github.com/franprzdev/geotucuman.git
   cd geotucuman
   npm install
   ```

2. Compilar el servidor (xmcp genera `dist/stdio.js` y `dist/http.js`):

   ```bash
   npm run build
   ```

3. Configurar el cliente MCP (ej. Claude Code) apuntando al build por stdio:

   ```json
   { "mcpServers": { "geomcp": { "command": "node", "args": ["/ruta/geotucuman/dist/stdio.js"] } } }
   ```

4. Regenerar catálogo y portal cuando haga falta:

   ```bash
   npm run catalog   # genera data/catalog.json desde los GetCapabilities en vivo
   npm run portal    # genera docs/index.html (miniweb) y docs/capas.html (catalogo)
   ```

Extras: `npm run smoke` (prueba end-to-end contra los servicios reales), `npm start` (server compilado por stdio) y `npm run start:http` (transporte http). Servidor armado con xmcp (https://xmcp.dev): tools auto-registradas desde src/tools/, transportes stdio y http (http disponible para hosting futuro, sin hosting configurado hoy).

### Ejemplos reales de uso

- **Buscar capas por palabra clave** — `search_layers`: pedile "capas de aeropuerto en Tucumán" y devuelve coincidencias del catálogo embebido, por ejemplo `WFS_GEOSPLAN:aeropuerto` (título "Aeropuerto Benjamín Matienzo"), con `typeName`, fuente, endpoint y CRS por defecto.
- **Sugerir capas desde un objetivo** — `suggest_layers`: "quiero armar un mapa de riego y pozos" devuelve candidatas puntuadas con su justificación, capacidades por servicio y evidencia de la fuente (determinista, sin LLM).
- **Describir y consultar una capa WFS** — `describe_layer` y después `query_layer`: `describe_layer("dgct:PARCELASR1")` trae los campos reales (DescribeFeatureType) y es obligatorio antes de consultar; recién entonces `query_layer` con ese `typeName` corre GetFeature. El bbox se pasa en EPSG:4326 (se reproyecta al CRS nativo de la capa, acá EPSG:5345), `maxFeatures` admite hasta 50 y se pagina con `startIndex` usando el `nextStartIndex` que devuelve la tool. `query_layer` aplica solo a capas WFS y ArcGIS REST: las WMS-only (por ejemplo las RIDES y las 7 fuentes INTA de suelos/cobertura/productividad) son imágenes para display y no admiten GetFeature.
- **Geocodificar texto libre** — `geocode`: "Yerba Buena, Tucumán" devuelve coordenadas vía la API nacional Georef (gratis, sin key).

## Web pública

Sitio público que explica qué es el MCP y cómo usarlo, más un índice de las capas descubribles y la salud de cada capa, publicados con GitHub Pages desde `docs/`: https://franprzdev.github.io/geotucuman/ (regenerar con `npm run portal`).

## Monitor de salud por capa

`npm run health` sondea cada servicio declarado de cada capa del catálogo: WMS con un GetMap (mismo CRS y bbox que `describe_layer`), WFS con un GetFeature de 1 registro (`maxFeatures=1`, `srsName=EPSG:4326`) y ArcGIS REST con un query (`where=1=1`, `resultRecordCount=1`, `f=json`). Usa un pool global de 8 con máximo 2 pedidos simultáneos por host y un reintento a los 2 s ante fallas de red o timeout. Escribe `data/health.json` (estado por fuente y por capa, latencia y detalle) y agrega una línea a `data/health-history.jsonl` (evolución diaria). Flags: `--sample N`, `--source <id>` y `--out <path>`.

Corre automáticamente todos los días vía GitHub Actions (`.github/workflows/health.yml`) y commitea los resultados; `npm run health-page` genera la página. Se publica en https://franprzdev.github.io/geotucuman/salud.html (fuente: `docs/salud.html`).

Ojo: que una capa falle no significa que su servidor esté caído. Puede ser una capa puntual despublicada, un GetMap que solo falla con cierto CRS/bbox o un endpoint lento; mirá el detalle por capa. El monitor tampoco prueba el contenido ni la licencia de cada capa, solo si el servicio responde. Las mediciones se hacen desde GitHub Actions (fuera de Argentina): un servicio con bloqueo geográfico puede figurar caído ahí y andar bien desde dentro del país.

## Fuentes (catálogo regenerado desde los GetCapabilities en vivo el 9/11/2026)

Nacionales:

- IGN nacional: https://wms.ign.gob.ar/geoserver/ows (https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/ServiciosOGC)
- API Georef: https://apis.datos.gob.ar/georef/api/

Provinciales (una fuente principal por provincia, WFS+WMS salvo indicación):

- Tucumán — Geosplan (Sec. Gestión Pública y Planeamiento): http://g.geosplan.tucuman.gob.ar/geoserver/WFS_GEOSPLAN/wfs
- Tucumán — Dirección General de Catastro: http://200.49.89.203/geoserver/dgct/wfs (documentado como experimental desde 2012: https://catastrotucuman.gov.ar/gestiones/servicio-wms-wfs/)
- Tucumán — RIDES (Ministerio de Producción): https://rides.producciontucuman.gob.ar/servicios-wms/ (9 servicios WMS ArcGIS)
- Ciudad Autónoma de Buenos Aires — Dirección General de Estadística y Censos: https://ideec.estadisticaciudad.gob.ar/geoserver/ows
- Buenos Aires — IDEBA: https://geoserver.ideba.gba.gob.ar/geoserver/wfs
- Chaco — IDEChaco: http://idechaco.gob.ar/geoserver/idechaco/wfs (solo HTTP; el host HTTPS geoportal.idechaco.gob.ar no acepta conexiones)
- Córdoba — IDECOR: https://idecor-ws.mapascordoba.gob.ar/geoserver/idecor/wfs
- Entre Ríos — IDE Entre Ríos: https://geoservicios.entrerios.gov.ar/geoserver/ows
- Jujuy — IDEJuy: https://geo.idejuy.jujuy.gob.ar/geoserver/wfs
- Misiones — Dirección Provincial de Vialidad: https://sigvial.dpvmisiones.gob.ar/geoserver/ows
- Neuquén — Dirección Provincial de Catastro e Información Territorial (solo WMS; su WFS ArcGIS no ofrece salida JSON): https://catastro.neuquen.gov.ar/nqn_ide/services/IDE/Catastro/MapServer/WMSServer
- Río Negro — IDERN: https://idern.rionegro.gov.ar/geoserver/wfs
- Salta — IDE Salta: https://geoportal.salta.gob.ar/geoserver/wfs
- San Juan — UNIDE (solo WMS): https://unide.sanjuan.gob.ar/geoserver/wms
- San Luis — Dirección Provincial de Catastro y Tierras Fiscales: http://visualcatsl.dyndns.info/geoserver/SanLuis/wfs (host dinámico)
- Santa Cruz — SIT Santa Cruz: https://situ.santacruz.gob.ar/geoserver/ows
- Tierra del Fuego — IDE TDF: https://tiles.tierradelfuego.gob.ar/geoserver/ows
- Mendoza — ArcGIS REST FeatureServer (tipo de servicio propio `arcgis`), con lista blanca explícita de 9 capas: estaciones de bomberos, bosques nativos, cuencas hidrográficas, departamentos 2024, glaciares IANIGLA, rutas IGN, suelos INTA y aridez pasada/futura. Sin volcado masivo de los cientos de servicios del directorio. No se declara licencia en los metadatos inspeccionados del servicio: se cita la fuente y no se promete derecho de redistribución. Los campos de usuario auditados no se solicitan ni se exponen.
- INTA (7 fuentes WMS-only, una capa explícita por fuente, probadas en vivo 8/11/2026):
  - Santiago del Estero — Suelos de Santiago del Estero: https://geo-nodo02.inta.gob.ar/geoserver/wms (capa `geonode:suelos`; metadatos https://geo-nodo02.inta.gob.ar/showmetadata/xsl/8)
  - Catamarca — Suelos de Catamarca: https://geo-nodo11.inta.gob.ar/geoserver/wms (capa `geonode:suelocatamarca_1_500`; metadatos https://geo-nodo11.inta.gob.ar/showmetadata/xsl/21)
  - La Rioja — Cobertura de Suelos de La Rioja: https://geo-nodo11.inta.gob.ar/geoserver/wms (capa `geonode:lccs_n3_2007_lr_c01bf1947b73120dcc56d9b76907d712`; metadatos https://geo-nodo11.inta.gob.ar/catalogue/csw?request=GetRecordById&service=CSW&version=2.0.2&id=35c8b3cd-7d96-45ec-adf8-a2b3f315b039&outputschema=http%3A%2F%2Fwww.isotc211.org%2F2005%2Fgmd&elementsetname=full)
  - Corrientes — Lomas Arenosas de Corrientes: https://geo-nodo09.inta.gob.ar/geoserver/wms (capa `geonode:Lomas_arenosas`; metadatos https://geo-nodo09.inta.gob.ar/showmetadata/xsl/251)
  - Santa Fe — Capacidad Productiva de Santa Fe: https://geo-nodo10.inta.gob.ar/geoserver/wms (capa `geonode:cpa_santa_fe`; metadatos https://geo-nodo10.inta.gob.ar/catalogue/csw?request=GetRecordById&service=CSW&version=2.0.2&id=8003225d-276c-48d1-bf84-af3f0c02320d&outputschema=http%3A%2F%2Fwww.isotc211.org%2F2005%2Fgmd&elementsetname=full)
  - Chubut — Unidades de Paisaje Patagonia Sur: https://geo-nodo06.inta.gob.ar/geoserver/wms (capa `geonode:psur_unidades_paisaje_3857`; metadatos https://geo-nodo06.inta.gob.ar/showmetadata/xsl/20)
  - La Pampa — Productividad Forrajera de La Pampa: https://geo-nodo15.inta.gob.ar/geoserver/wms (capa `geonode:productividad_forrajera_la_pampaf78de876da1c`; metadatos https://geo-nodo15.inta.gob.ar/catalogue/csw?request=GetRecordById&service=CSW&version=2.0.2&id=11400a25-9948-4c42-8eec-ee2a3a1de4fd&outputschema=http%3A%2F%2Fwww.isotc211.org%2F2005%2Fgmd&elementsetname=full)

Índice de organismos de Tucumán (IDET): https://idet.tucuman.gob.ar/servicios/

Pendientes de incorporar (relevadas el 7/11/2026, actualizado el 8/11/2026; queda 1): Formosa. El IDEF publicó su endpoint WMS en /servicios/wms?version=1.1.1 pero responde HTTP 500, la variante HTTPS está cerrada y el nodo INTA 14 no expone capas en sus GetCapabilities; no se declara cobertura nacional completa. Las demás fuentes antes listadas como pendientes (Corrientes, Catamarca, La Pampa, Santa Fe, La Rioja, Santiago del Estero y Chubut) se integraron el 8/11/2026 mediante 7 fuentes INTA WMS-only con lista blanca de una capa por fuente, probadas en vivo. Esa integración INTA no es exhaustiva: la representación territorial y temática es parcial — Corrientes solo cubre el área cartografiada de Lomas Arenosas (no la provincia completa); Chubut usa una capa regional Patagonia Sur sin recorte provincial; La Rioja aporta cobertura de suelo histórica 2006-2007; La Pampa aporta productividad forrajera modelada 2001-2011 / series 2000-2013; Catamarca y Santiago del Estero aportan suelos. No se afirma que todas las capas de cada nodo INTA estén revisadas: en cada fuente se indexa exactamente una capa. El monitor de IDERA (https://controlserviciosidera.iado-conicet.gob.ar/resource/581?lang=en) muestra para Formosa LastCheck 2026-11-08T03:04:00Z con Success=False y RemoteDisconnected, la misma falla externa observada; es orientación, no prueba de disponibilidad actual, y no se afirma que todas las fuentes estén vivas o geobloqueadas globalmente.

`search_layers` acepta un filtro opcional `province` (ej: "Córdoba") para acotar por provincia.

### Catálogo reproducible (caché de capacidades)

`npm run catalog` regenera `data/catalog.json` desde los GetCapabilities en vivo y, además, guarda cada respuesta cruda (WFS/WMS XML y JSON de ArcGIS REST) en `data/capabilities/<fuente>/`, junto con un `_meta.json` por fuente (fecha de captura y archivos usados). Esa caché se versiona para poder reconstruir el catálogo sin red.

`GEOARG_FROM_CACHE=1 npm run catalog` reconstruye el catálogo únicamente desde `data/capabilities/` (no toca la red) y de forma byte-idéntica: `generatedAt` y `verifiedAt` se derivan de la `fetchedAt` más reciente de la caché en lugar de la hora actual. Si falta un archivo de caché requerido el build falla con un mensaje claro; si una fuente no tiene caché, conserva su snapshot previo. `npm run validate-catalog` revisa el catálogo (ids únicos iguales a `source:typeName`, campos y URLs obligatorios, `verifiedAt` en `YYYY-MM-DD`, servicios válidos y fuentes declaradas) y corre en CI.

### Resumen de fuentes y cobertura

| Fuente | Jurisdicción | Tipo | Capas indexadas | Cobertura |
| --- | --- | --- | --- | --- |
| Geosplan | Tucumán | WFS+WMS | todas (GetCapabilities) | provincial |
| DGCT | Tucumán | WFS+WMS | todas (GetCapabilities) | provincial, intermitente |
| RIDES | Tucumán | WMS (9 servicios) | todas por servicio | provincial |
| CABA | CABA | WFS+WMS | todas | jurisdiccional |
| IDEBA | Buenos Aires | WFS+WMS | todas | provincial |
| IDEChaco | Chaco | WFS+WMS | todas | provincial |
| IDECOR | Córdoba | WFS+WMS | todas | provincial |
| IDE Entre Ríos | Entre Ríos | WFS+WMS | todas | provincial |
| IDEJuy | Jujuy | WFS+WMS | todas | provincial |
| Vialidad Misiones | Misiones | WFS+WMS | todas | provincial |
| Catastro Neuquén | Neuquén | WMS-only | todas | provincial |
| IDERN | Río Negro | WFS+WMS | todas | provincial |
| IDE Salta | Salta | WFS+WMS | todas | provincial |
| UNIDE | San Juan | WMS-only | todas | provincial |
| Catastro San Luis | San Luis | WFS+WMS | todas | provincial, host dinámico |
| SIT Santa Cruz | Santa Cruz | WFS+WMS | todas | provincial |
| IDE TDF | Tierra del Fuego | WFS+WMS | todas | provincial |
| Mendoza | Mendoza | ArcGIS (whitelist 9) | 9 explícitas | provincial, no exhaustiva |
| IGN | Argentina | WFS+WMS | todas | nacional |
| INTA nodo02 | Santiago del Estero | WMS-only (whitelist 1) | `geonode:suelos` | suelos 1:500000 |
| INTA nodo11 | Catamarca | WMS-only (whitelist 1) | `geonode:suelocatamarca_1_500` | suelos 1:500000 |
| INTA nodo11 | La Rioja | WMS-only (whitelist 1) | `geonode:lccs_n3_2007_lr_c01bf1947b73120dcc56d9b76907d712` | cobertura histórica 2006-2007 |
| INTA nodo09 | Corrientes | WMS-only (whitelist 1) | `geonode:Lomas_arenosas` | solo área cartografiada Lomas Arenosas, no provincia completa |
| INTA nodo10 | Santa Fe | WMS-only (whitelist 1) | `geonode:cpa_santa_fe` | capacidad productiva 1:250000 |
| INTA nodo06 | Chubut | WMS-only (whitelist 1) | `geonode:psur_unidades_paisaje_3857` | regional Patagonia Sur, sin recorte provincial |
| INTA nodo15 | La Pampa | WMS-only (whitelist 1) | `geonode:productividad_forrajera_la_pampaf78de876da1c` | modelado 2001-2011 / series 2000-2013 |

La tabla refleja lo configurado e indexado, no una inspección capa por capa de cada servicio. En las fuentes INTA se indexa exactamente una capa por fuente; otras capas publicadas por los nodos INTA no fueron revisadas ni incorporadas. Requiere verificación previa antes de usar cualquier capa concreta en producción.

## Estado verificado (8/11/2026)

- Catálogo regenerado en vivo el 8/11/2026: 3691 capas de 26 fuentes configuradas de capas (25 subnacionales + IGN; 25 URLs de servicio distintas, porque Catamarca y La Rioja comparten nodo11; Georef es una API adicional, no aporta capas al catálogo). Respecto de las 3684 previas se suman 7 capas INTA (una por fuente, lista blanca explícita) integradas y probadas en vivo ese día; las 3684 anteriores quedan sin cambios. Las fuentes WFS/WMS se descubren mediante GetCapabilities; Mendoza usa metadatos y query de ArcGIS REST; las fuentes INTA usan WMS-only con lista blanca de una capa exacta por fuente. La verificación de capas representativas no garantiza la disponibilidad de cada capa.
- Smoke completo (npm run smoke) 12/12 PASS el 4/11/2026, con GetFeature real contra Geosplan, DGCT e IGN, y MCP smoke 10/10. Smoke existente más los nuevos tests de ArcGIS (describe/query/paginación/bbox/filtro por servicio) todos PASS el 8/11/2026; regresión MCP stdio PASS; tests offline en CI. Entre el 31/10 y el 2/11/2026 el IGN estuvo caído por un problema de DNS del propio organismo (wms.ign.gob.ar no resolvía; diagnóstico en diagnostics/2026-10-31-ign-dns.md) y volvió sin cambios de este lado. Paginacion (startIndex/nextStartIndex) verificada en Geosplan.
- El bbox se pasa en EPSG:4326 y el cliente lo reproyecta al CRS nativo de la capa antes de filtrar (verificado: bbox 4326 sobre capa proyectada devuelve 0 si se manda directo). Reproyección Gauss-Krüger/TM propia para EPSG:22183 y EPSG:5345, contrastada contra proj4 con error <0.001 m. Para otro CRS nativo, el MCP devuelve un error claro en vez de 0 silencioso.
- CRS por defecto varía por capa (observados EPSG:22183, 5345, 4326). Las geometrías se piden siempre con `srsName=EPSG:4326`.
- El endpoint de Catastro (DGCT) es intermitente: el 30/10/2026 a la madrugada no respondió (timeout de conexión) y volvió el mismo día; el catálogo registra por fuente si las capas son fetch en vivo o snapshot conservado.

## Licencias por fuente (verificado 30/10/2026)

Que un servicio sea público no significa reutilizable. Lo siguiente son los términos publicados por cada organismo a nivel sitio/servicio, no licencias por capa; revisá el enlace antes de redistribuir datos de una capa concreta:

- **Geosplan (Planeamiento, Tucumán):** [términos de uso del sitio](http://geosplan.tucuman.gov.ar/index.php/institucional/terminos-de-uso/): "Comparte la información en los términos que establece las licencias Creative Commons: Reconocimiento-No comercial-Compartir Igual", con criterios: "Que el contenido de la información no sea alterado", "Que no se desnaturalice el sentido de la información", "Que se cite la fuente", "Que se mencione la fecha de la última actualización", "Que no se persigan fines comerciales con la obra original o la utilización de la información publicada".
- **IGN (nacional):** [términos y condiciones](https://www.ign.gob.ar/descargas/tyc1.html) para "información descargada del sitio web del IGN": "Debe reconocerse la autoría del Instituto Geográfico Nacional de la República Argentina. Se debe compartir de manera libre y gratuita. Se permite su uso comercial únicamente en el caso de obras derivadas en que la información sea utilizada como insumo para generar un nuevo producto. El IGN no se responsabiliza por las consecuencias de la utilización de la información descargada."
- **Catastro (DGCT, Tucumán):** [servicio WMS/WFS](https://catastrotucuman.gov.ar/gestiones/servicio-wms-wfs/): no se publica licencia ni términos de uso; el servicio está documentado como experimental desde 2012.
- **Georef (geocodificación):** [condiciones de uso](https://www.argentina.gob.ar/georef/condiciones-de-uso-y-licencia): "Atribución obligatoria: se debe mencionar la fuente como 'Servicio Georef – argentina.gob.ar/georef' o incluir un enlace al sitio oficial. Indicación de modificaciones: si se redistribuye la información con cambios, debe indicarse que ha sido modificada. Uso responsable."
- **Licencia por capa: sin verificar en las fuentes legacy.** Los GetCapabilities no publican licencia por capa. De las 7 fuentes INTA se revisaron los metadatos de cada capa indexada (detalle abajo); el resto de las fuentes no tiene licencia por capa verificada, y el enriquecimiento con metadatos IDERA (que podría traerla) sigue pendiente.
- **INTA - Santiago del Estero (suelos):** licencia no especificada por el autor en los metadatos; reuso no autorizado por inferencia.
- **INTA - Catamarca (suelos), La Rioja (cobertura de suelos 2006-2007), Corrientes (Lomas Arenosas), Santa Fe (capacidad productiva) y Chubut (Patagonia Sur):** dominio público (PD) declarado en metadatos; las citas de autoría por capa están en los `coverageNote` y `license.attribution` de cada fuente y conviene revisarlas antes de redistribuir.
- **INTA - La Pampa (productividad forrajera):** cita textual de los metadatos: "Atribución - No Comercial (by-nc): Se permite la generación de obras derivadas siempre que no se haga con fines comerciales. Tampoco se puede utilizar la obra original con fines comerciales. Esta licencia no es una licencia libre." Los metadatos además contienen una contradicción entre dominio público (PD) y esta cláusula by-nc, y no indican versión CC. GeoArg indexa metadatos y enlaza; no aloja ni redistribuye raster/vector. La prueba GetMap es transitoria y devuelve solo estado, no imagen; no se concede reutilización comercial.

## Límites (sin maquillar)

- Vigencia variable: varias capas de Geosplan son 2008-2017 según sus nombres; frecuencia de actualización no verificada.
- Disponibilidad: algunos endpoints usan HTTP plano o IP y son intermitentes (DGCT cayó y volvió el 30/10/2026); el cliente contempla timeouts y errores. El IGN tuvo una caída de DNS externa del 31/10 al 2/11/2026 y volvió solo; el catálogo sobrevive esas caídas conservando el último snapshot marcado como tal.
- Contenido por capa no inspeccionado en profundidad: regla de diseño = lista blanca y exclusión de datos personales.
- Enriquecimiento con metadatos IDERA: pendiente (su catálogo no respondió el 29/10/2026).

## Roadmap

1. Enriquecimiento de catálogo con metadatos IDERA (licencia por capa, fecha, organismo).
2. Encadenamiento espacial (feature_ref): contar/intersectar entre capas, sujeto a prueba de soporte por endpoint.
3. Reproyección para CRS nativos fuera de EPSG:22183/5345/4326 si aparecen capas con otros CRS.
4. Reintentar la provincia pendiente (Formosa) desde una red que el servicio acepte; se toma el monitor IDERA como orientación, no como prueba de disponibilidad actual. Evaluar la ampliación de las 7 fuentes INTA ya integradas (una capa por fuente) hacia más capas por nodo, con validación de territorio y licencia capa por capa. La representación INTA actual no es exhaustiva: Corrientes solo cubre Lomas Arenosas, Chubut aporta una capa regional sin recorte provincial, La Rioja es cobertura histórica 2006-2007 y La Pampa es modelada 2001-2011 / series 2000-2013.
5. Hosting público del MCP (el transporte HTTP ya corre en local con npm run start:http).

Licencia del código: MIT. Los datos son de sus organismos publicadores.
