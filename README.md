# GeoMCP

MCP (Model Context Protocol) de **descubrimiento y consulta de geodatos públicos**. Corre local por stdio con tu cliente (Claude Code, etc.). El catálogo cubre el IGN nacional, la API Georef y fuentes oficiales de 14 provincias (detalle abajo).

> Antes **GeoTucumán**; renombrado a **GeoMCP** el 4/11/2026. El repositorio y la URL pública no cambian.

**Qué es:** una capa de descubrimiento y consulta sobre servicios oficiales WFS y WMS, más la API Georef.
**Qué NO es:** un SIG completo, ni un visor, ni una copia de los datos. Consulta en vivo y cita la fuente.

## Herramientas

| Tool | Qué hace |
| --- | --- |
| `search_layers` | Busca capas por palabra clave en el catálogo embebido (filtro opcional por tipo de servicio WFS/WMS) |
| `suggest_layers` | Sugiere capas a partir de un objetivo en texto libre (determinista, sin LLM) |
| `describe_layer` | Campos reales de una capa (obligatorio antes de consultar) |
| `query_layer` | GetFeature con filtros, paginación y bbox en EPSG:4326 (se reproyecta al CRS nativo de la capa en el cliente) |
| `geocode` | Texto libre a coordenadas vía API Georef (gratis, sin key) |

Las capas WMS-only se buscan y describen igual (metadatos vía GetCapabilities); `query_layer` aplica a capas WFS.

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
- **Describir y consultar una capa WFS** — `describe_layer` y después `query_layer`: `describe_layer("dgct:PARCELASR1")` trae los campos reales (DescribeFeatureType) y es obligatorio antes de consultar; recién entonces `query_layer` con ese `typeName` corre GetFeature. El bbox se pasa en EPSG:4326 (se reproyecta al CRS nativo de la capa, acá EPSG:5345), `maxFeatures` admite hasta 50 y se pagina con `startIndex` usando el `nextStartIndex` que devuelve la tool. `query_layer` aplica solo a capas WFS: las WMS-only (por ejemplo las RIDES) son imágenes para display y no admiten GetFeature.
- **Geocodificar texto libre** — `geocode`: "Yerba Buena, Tucumán" devuelve coordenadas vía la API nacional Georef (gratis, sin key).

## Web pública

Sitio público que explica qué es el MCP y cómo usarlo, más un índice de las capas descubribles, publicados con GitHub Pages desde `docs/`: https://franprzdev.github.io/geotucuman/ (regenerar con `npm run portal`).

## Fuentes (catálogo regenerado desde los GetCapabilities en vivo el 7/11/2026)

Nacionales:

- IGN nacional: https://wms.ign.gob.ar/geoserver/ows (https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/ServiciosOGC)
- API Georef: https://apis.datos.gob.ar/georef/api/

Provinciales (una fuente principal por provincia, WFS+WMS salvo indicación):

- Tucumán — Geosplan (Sec. Gestión Pública y Planeamiento): http://g.geosplan.tucuman.gob.ar/geoserver/WFS_GEOSPLAN/wfs
- Tucumán — Dirección General de Catastro: http://200.49.89.203/geoserver/dgct/wfs (documentado como experimental desde 2012: https://catastrotucuman.gov.ar/gestiones/servicio-wms-wfs/)
- Tucumán — RIDES (Ministerio de Producción): https://rides.producciontucuman.gob.ar/servicios-wms/ (9 servicios WMS ArcGIS)
- Ciudad Autónoma de Buenos Aires — Dirección General de Estadística y Censos: https://ideec.estadisticaciudad.gob.ar/geoserver/ows
- Buenos Aires — IDEBA: https://geoserver.ideba.gba.gob.ar/geoserver/wfs
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

Índice de organismos de Tucumán (IDET): https://idet.tucuman.gob.ar/servicios/

Pendientes de incorporar (relevadas el 7/11/2026, sin servicio verificable desde nuestra red en este momento): Chaco (IDEChaco, verificada una vez con 998 capas WFS y luego dejó de aceptar conexiones de esta red), Corrientes (ídem, 67 capas), Catamarca (403), La Pampa, Santa Fe, Formosa, Mendoza (idemza2 con 503), La Rioja (522) y Santiago del Estero (sin endpoint OGC público hallado). El monitor de IDERA (https://controlserviciosidera.iado-conicet.gob.ar/) las registra como vivas desde Argentina, así que varias parecen limitar tráfico exterior; se reintentan desde otra red.

`search_layers` acepta un filtro opcional `province` (ej: "Córdoba") para acotar por provincia.

## Estado verificado (7/11/2026)

- Catálogo regenerado en vivo el 7/11/2026: 2593 capas de 17 fuentes (14 provincias + IGN nacional). Fuentes nuevas validadas una por una con GetCapabilities en vivo; Neuquén (ArcGIS) además con DescribeFeatureType y GetFeature reales.
- Smoke completo (npm run smoke) 12/12 PASS el 4/11/2026, con GetFeature real contra Geosplan, DGCT e IGN, y MCP smoke 10/10. Entre el 31/10 y el 2/11/2026 el IGN estuvo caído por un problema de DNS del propio organismo (wms.ign.gob.ar no resolvía; diagnóstico en diagnostics/2026-10-31-ign-dns.md) y volvió sin cambios de este lado. Paginacion (startIndex/nextStartIndex) verificada en Geosplan.
- El bbox se pasa en EPSG:4326 y el cliente lo reproyecta al CRS nativo de la capa antes de filtrar (verificado: bbox 4326 sobre capa proyectada devuelve 0 si se manda directo). Reproyección Gauss-Krüger/TM propia para EPSG:22183 y EPSG:5345, contrastada contra proj4 con error <0.001 m. Para otro CRS nativo, el MCP devuelve un error claro en vez de 0 silencioso.
- CRS por defecto varía por capa (observados EPSG:22183, 5345, 4326). Las geometrías se piden siempre con `srsName=EPSG:4326`.
- El endpoint de Catastro (DGCT) es intermitente: el 30/10/2026 a la madrugada no respondió (timeout de conexión) y volvió el mismo día; el catálogo registra por fuente si las capas son fetch en vivo o snapshot conservado.

## Licencias por fuente (verificado 30/10/2026)

Que un servicio sea público no significa reutilizable. Lo siguiente son los términos publicados por cada organismo a nivel sitio/servicio, no licencias por capa; revisá el enlace antes de redistribuir datos de una capa concreta:

- **Geosplan (Planeamiento, Tucumán):** [términos de uso del sitio](http://geosplan.tucuman.gov.ar/index.php/institucional/terminos-de-uso/): "Comparte la información en los términos que establece las licencias Creative Commons: Reconocimiento-No comercial-Compartir Igual", con criterios: "Que el contenido de la información no sea alterado", "Que no se desnaturalice el sentido de la información", "Que se cite la fuente", "Que se mencione la fecha de la última actualización", "Que no se persigan fines comerciales con la obra original o la utilización de la información publicada".
- **IGN (nacional):** [términos y condiciones](https://www.ign.gob.ar/descargas/tyc1.html) para "información descargada del sitio web del IGN": "Debe reconocerse la autoría del Instituto Geográfico Nacional de la República Argentina. Se debe compartir de manera libre y gratuita. Se permite su uso comercial únicamente en el caso de obras derivadas en que la información sea utilizada como insumo para generar un nuevo producto. El IGN no se responsabiliza por las consecuencias de la utilización de la información descargada."
- **Catastro (DGCT, Tucumán):** [servicio WMS/WFS](https://catastrotucuman.gov.ar/gestiones/servicio-wms-wfs/): no se publica licencia ni términos de uso; el servicio está documentado como experimental desde 2012.
- **Georef (geocodificación):** [condiciones de uso](https://www.argentina.gob.ar/georef/condiciones-de-uso-y-licencia): "Atribución obligatoria: se debe mencionar la fuente como 'Servicio Georef – argentina.gob.ar/georef' o incluir un enlace al sitio oficial. Indicación de modificaciones: si se redistribuye la información con cambios, debe indicarse que ha sido modificada. Uso responsable."
- **Licencia por capa: sin verificar.** Los GetCapabilities no publican licencia por capa; el enriquecimiento con metadatos IDERA (que podría traerla) sigue pendiente.

## Límites (sin maquillar)

- Vigencia variable: varias capas de Geosplan son 2008-2017 según sus nombres; frecuencia de actualización no verificada.
- Disponibilidad: algunos endpoints usan HTTP plano o IP y son intermitentes (DGCT cayó y volvió el 30/10/2026); el cliente contempla timeouts y errores. El IGN tuvo una caída de DNS externa del 31/10 al 2/11/2026 y volvió solo; el catálogo sobrevive esas caídas conservando el último snapshot marcado como tal.
- Contenido por capa no inspeccionado en profundidad: regla de diseño = lista blanca y exclusión de datos personales.
- Enriquecimiento con metadatos IDERA: pendiente (su catálogo no respondió el 29/10/2026).

## Roadmap

1. Enriquecimiento de catálogo con metadatos IDERA (licencia por capa, fecha, organismo).
2. Encadenamiento espacial (feature_ref): contar/intersectar entre capas, sujeto a prueba de soporte por endpoint.
3. Reproyección para CRS nativos fuera de EPSG:22183/5345/4326 si aparecen capas con otros CRS.
4. Reintentar las provincias pendientes (Chaco, Corrientes, Catamarca, La Pampa, Santa Fe, Formosa, Mendoza, La Rioja, Santiago del Estero) desde una red que los servicios acepten; varias figuran vivas en el monitor de IDERA.
5. Hosting público del MCP (el transporte HTTP ya corre en local con npm run start:http).

Licencia del código: MIT. Los datos son de sus organismos publicadores.
