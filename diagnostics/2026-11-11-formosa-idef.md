# Log de fallos y diagnóstico — Formosa (IDE Formosa) — 2026-11-11

Relevamiento de la única jurisdicción argentina sin fuente oficial operativa en GeoArg.
Todos los datos de este informe se verificaron el 11/11/2026.

- Jurisdicción: Formosa, la única de las 24 (23 provincias + CABA) sin fuente operativa en GeoArg.
- Servicio: IDE Formosa (IDEF), https://idef.formosa.gob.ar/servicios/web/ — GeoServer 2.10.0.
- Monitor oficial: IDERA, https://controlserviciosidera.iado-conicet.gob.ar/resources?lang=es&tag=IDEF
- Ventana del monitor: 2026-10-11 a 2026-11-10.
- Contacto publicado por el geoportal: idef@formosa.gob.ar (Dirección General del Catastro Territorial, Formosa).
- Alcance: no se modificó el código ni el catálogo; Formosa no está integrada en `src/endpoints.ts`.

## Qué se probó

1. `GET` a la portada (welcome page) del GeoServer de IDEF.
2. `GetCapabilities` WMS y WFS contra el endpoint público.
3. Handshake TLS y respuesta HTTP desde varias redes cliente fuera de Argentina.
4. Consulta al monitor oficial de IDERA (ventana 2026-10-11 a 2026-11-10).

## Qué falla (exactamente)

| Prueba | Resultado |
| --- | --- |
| Portada del GeoServer | Responde; anuncia WMS 1.1.1/1.3.0 y WFS 1.0.0/1.1.0/2.0.0 |
| WMS GetCapabilities | Conexión cerrada sin respuesta desde fuera de Argentina |
| WFS GetCapabilities | Conexión cerrada sin respuesta desde fuera de Argentina |
| Monitor IDERA (IDEF WMS) | 27,42% de confiabilidad en la ventana; hoy 0/2 recursos operativos |

## Por qué falla (diagnóstico)

### Confirmado con evidencia

1. La portada del GeoServer responde y anuncia capacidades WMS 1.1.1/1.3.0 y WFS 1.0.0/1.1.0/2.0.0, pero las solicitudes WMS/WFS GetCapabilities no completan: el servidor cierra la conexión sin respuesta y los crawlers registran esos errores.
2. Las conexiones directas desde IPs extranjeras se descartan después del handshake: el TLS completa (TLSv1.2, certificado válido) y enseguida el servidor cierra la conexión al recibir la petición HTTP (OpenSSL: `unexpected eof`). Se reprodujo desde múltiples redes cliente.
3. El monitor oficial de IDERA confirma la degradación de forma independiente: para la ventana 2026-10-11 a 2026-11-10 el WMS de IDEF figura con 27,42% de confiabilidad y, al cierre de este informe, 0 de 2 recursos operativos.
4. El bloqueo es del lado del servidor, no de GeoArg: el cierre de conexión ocurre antes de cualquier procesamiento propio del MCP.

### Hipótesis (no verificadas)

- Geobloqueo o filtrado por IP en el borde del organismo (firewall/WAF), o ruteo que solo acepta tráfico desde dentro de Argentina. No hay forma de confirmarlo desde afuera.

### NO verificado

- Si el WMS/WFS de Formosa respondería bien desde dentro de Argentina (no se pudo llegar al servicio).
- La causa exacta del corte ni cuándo se restablecerá.
- Si el geoportal publica licencia reutilizable por capa.

## Cómo integrarla cuando responda

1. Agregar un `EndpointConfig` en `src/endpoints.ts` con `id: 'formosa'` y `province: 'Formosa'`.
2. Correr `npm run catalog` para indexar las capacidades de la fuente.
3. El monitor diario de salud (`npm run health`) empieza a hacer seguimiento de la fuente automáticamente.

Mientras el servicio siga cerrando las conexiones desde fuera de Argentina, la integración queda bloqueada del lado del servidor y documentada acá.
