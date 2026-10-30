# GeoTucumán

MCP (Model Context Protocol) de **descubrimiento y consulta de geodatos públicos**, empezando por Tucumán, Argentina. Corre local por stdio con tu cliente (Claude Code, etc.).

**Qué es:** una capa de descubrimiento y consulta sobre servicios WFS oficiales y la API Georef.
**Qué NO es:** un SIG completo, ni un visor, ni una copia de los datos. Consulta en vivo y cita la fuente.

## Herramientas

| Tool | Qué hace |
| --- | --- |
| `buscar_capas` | Busca capas por palabra clave en el catálogo embebido |
| `describir_capa` | Campos reales de una capa (obligatorio antes de consultar) |
| `consultar_capa` | GetFeature con filtros, paginación y bbox (en CRS nativo) |
| `geocodificar` | Texto libre a coordenadas vía API Georef (gratis, sin key) |

## Quickstart

```bash
npm install
npm run catalog   # genera data/catalog.json desde los GetCapabilities en vivo
npm run smoke     # prueba end-to-end contra los servicios reales
npm run portal    # genera docs/index.html (portal de capas)
npm run build && npm start   # servidor MCP por stdio
```

Config de cliente MCP (ej. Claude Code):

```json
{ "mcpServers": { "geotucuman": { "command": "node", "args": ["/ruta/geotucuman/dist/server.js"] } } }
```

## Fuentes (verificadas 29/10/2026)

- Geosplan (Sec. Gestión Pública y Planeamiento, Tucumán): http://g.geosplan.tucuman.gob.ar/geoserver/WFS_GEOSPLAN/wfs
- Dirección General de Catastro, Tucumán: http://200.49.89.203/geoserver/dgct/wfs (documentado como experimental desde 2012: https://catastrotucuman.gov.ar/gestiones/servicio-wms-wfs/)
- IGN nacional: https://wms.ign.gob.ar/geoserver/ows (https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/ServiciosOGC)
- API Georef: https://apis.datos.gob.ar/georef/api/
- IDET Tucumán (índice de organismos): https://idet.tucuman.gob.ar/servicios/

## Estado verificado (29-30/10/2026)

- GetFeature real funciona en los 3 endpoints (GeoJSON). Paginación (`startIndex`) verificada en Geosplan.
- Filtro bbox funciona **en el CRS nativo de la capa**; un bbox en 4326 sobre capa con CRS nativo proyectado devuelve 0. Hay que reproyectar el bbox antes de filtrar (pendiente como helper).
- CRS por defecto varía por capa (observados EPSG:22183, 5345, 4326). Pedir siempre `srsName=EPSG:4326` para la salida.

## Límites (sin maquillar)

- **Licencias por capa: pendientes.** Que un servicio sea público no significa reutilizable; citar no resuelve licencia. Revisar capa por capa antes de redistribuir.
- Vigencia variable: varias capas de Geosplan son 2008-2017 según sus nombres; frecuencia de actualización no verificada.
- Disponibilidad: algunos endpoints usan HTTP plano o IP; el cliente contempla timeouts y errores.
- Contenido por capa no inspeccionado en profundidad: regla de diseño = lista blanca y exclusión de datos personales.
- Enriquecimiento con metadatos IDERA: pendiente (su catálogo no respondió el 29/10/2026).

## Roadmap

1. Helper de reproyección de bbox (cliente) para filtros 4326 sobre cualquier capa.
2. Enriquecimiento de catálogo con metadatos IDERA (licencia, fecha, organismo).
3. Encadenamiento espacial (feature_ref): contar/intersectar entre capas, sujeto a prueba de soporte por endpoint.

Licencia del código: MIT. Los datos son de sus organismos publicadores.
