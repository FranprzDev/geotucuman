# GeoTucumán

MCP (Model Context Protocol) de **descubrimiento y consulta de geodatos públicos**, empezando por Tucumán, Argentina. Corre local por stdio con tu cliente (Claude Code, etc.).

**Qué es:** una capa de descubrimiento y consulta sobre servicios WFS oficiales y la API Georef.
**Qué NO es:** un SIG completo, ni un visor, ni una copia de los datos. Consulta en vivo y cita la fuente.

## Herramientas

| Tool | Qué hace |
| --- | --- |
| `buscar_capas` | Busca capas por palabra clave en el catálogo embebido |
| `describir_capa` | Campos reales de una capa (obligatorio antes de consultar) |
| `consultar_capa` | GetFeature con filtros, paginación y bbox en EPSG:4326 (se reproyecta al CRS nativo de la capa en el cliente) |
| `geocodificar` | Texto libre a coordenadas vía API Georef (gratis, sin key) |

## Quickstart

```bash
npm install
npm run catalog   # genera data/catalog.json desde los GetCapabilities en vivo
npm run smoke     # prueba end-to-end contra los servicios reales
npm run portal    # genera docs/index.html (miniweb) y docs/capas.html (catalogo)
npm run build && npm start   # build con xmcp (genera dist/stdio.js + dist/http.js) y servidor MCP por stdio (npm run start:http para http)
```

Servidor armado con xmcp (https://xmcp.dev): tools auto-registradas desde src/tools/, transportes stdio y http (http disponible para hosting futuro, sin hosting configurado hoy).

## Web pública

Sitio público que explica qué es el MCP y cómo usarlo, más un índice de las capas descubribles, publicados con GitHub Pages desde `docs/`: https://franprzdev.github.io/geotucuman/ (regenerar con `npm run portal`).

Config de cliente MCP (ej. Claude Code):

```json
{ "mcpServers": { "geotucuman": { "command": "node", "args": ["/ruta/geotucuman/dist/stdio.js"] } } }
```

## Fuentes (verificadas 29/10/2026)

- Geosplan (Sec. Gestión Pública y Planeamiento, Tucumán): http://g.geosplan.tucuman.gob.ar/geoserver/WFS_GEOSPLAN/wfs
- Dirección General de Catastro, Tucumán: http://200.49.89.203/geoserver/dgct/wfs (documentado como experimental desde 2012: https://catastrotucuman.gov.ar/gestiones/servicio-wms-wfs/)
- IGN nacional: https://wms.ign.gob.ar/geoserver/ows (https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/ServiciosOGC)
- API Georef: https://apis.datos.gob.ar/georef/api/
- IDET Tucumán (índice de organismos): https://idet.tucuman.gob.ar/servicios/

## Estado verificado (30/10/2026)

- GetFeature real funciona en los 3 endpoints (GeoJSON). Paginación (`startIndex`/`nextStartIndex`) verificada en Geosplan.
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
- Disponibilidad: algunos endpoints usan HTTP plano o IP y son intermitentes (DGCT cayó y volvió el 30/10/2026); el cliente contempla timeouts y errores.
- Contenido por capa no inspeccionado en profundidad: regla de diseño = lista blanca y exclusión de datos personales.
- Enriquecimiento con metadatos IDERA: pendiente (su catálogo no respondió el 29/10/2026).

## Roadmap

1. Enriquecimiento de catálogo con metadatos IDERA (licencia por capa, fecha, organismo).
2. Encadenamiento espacial (feature_ref): contar/intersectar entre capas, sujeto a prueba de soporte por endpoint.
3. Reproyección para CRS nativos fuera de EPSG:22183/5345/4326 si aparecen capas con otros CRS.
4. Incorporar fuentes públicas faltantes: RIDES (Producción, Tucumán) y el portal de Datos Abiertos de Tucumán.
5. HTTP/hosting del MCP si se migra a un framework con transporte HTTP.

Licencia del código: MIT. Los datos son de sus organismos publicadores.
