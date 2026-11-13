# Changelog

All notable changes to GeoArg are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/) (pre-1.0: minor bumps for feature batches).

## [0.3.0] - 2026-11-12

### Added

- Public MCP server over Streamable HTTP as a Cloudflare Worker (`https://geoarg-mcp.franprzdev.workers.dev/mcp`), stateless, read-only, no API key; deploy workflow and worker smoke test (#39).
- MiniSearch relevance engine for `search_layers`/`suggest_layers`, replacing the hand-written per-topic synonym lists: field boosts (title > identifier > keywords > abstract), diacritic folding, light Spanish plural reduction and bounded fuzzy matching, after IGN France's GeoContext pattern (#47).
- `relatedTerms` parameter on both search tools so the calling assistant bridges languages/synonyms (bilingual catalog metadata), plus honest `noCoverage` reporting of goal terms no layer covers (#47).
- Fires/hotspots coverage so "focos de calor" goals reach the CONAE MODIS/VIIRS layers (#46).
- ArcGIS REST (FeatureServer) support - describe/query/pagination/bbox - and nine reviewed Mendoza layers (#35).
- IDEChaco (Chaco) source: 15 subnational jurisdictions indexed (#34). Seven reviewed regional INTA WMS sources (soil/cover/productivity), one allowlisted layer each (#36).
- Per-layer daily health monitor with the public page `salud.html`, run from GitHub Actions (#37).
- Catalog validation in CI and byte-reproducible catalog builds from the committed capability cache (`GEOARG_FROM_CACHE=1`, `GEOARG_ONLY`) (#38).
- 24/24 jurisdiction documentation: Formosa's server blocks non-Argentine connections (with evidence), Malvinas covered under TDF-AIAS/IGN only (#40).
- Applied end-to-end example: fire hotspots (CONAE) vs water infrastructure (RIDES) in Tucumán, with fixtures and offline mode (#41).
- Discoverability: `docs/mcp.html` with JSON-LD and no-JS readable docs, `llms.txt`, sitemap (#43); static blog with three data-driven posts (#44).

### Changed

- Project renamed to GeoArg (formerly GeoMCP, formerly GeoTucumán) (#33).
- Site accent switched to green, matching the SIG poster (#45).
- San Juan (UNIDE) catalog refreshed from live GetCapabilities after a server-side GeoServer reorganization: 68 → 58 layers (40 removed because the server no longer publishes them, 30 new: Minería, OSSE, DPDU, Catastro, DRSU, Red Tulum transport). Catalog total 3,691 → 3,681 (#48).

### Fixed

- `salud.html` sticky table header opacity (#42).

## [0.2.0] - 2026-11-07

- 13 new verified provincial sources: CABA, Buenos Aires, Córdoba, Entre Ríos, Jujuy, Misiones, Neuquén, Río Negro, Salta, San Juan, San Luis, Santa Cruz and Tierra del Fuego.
- Catalog: 543 → 2,586 real layers from live GetCapabilities; 17 sources, 16 jurisdictions + IGN national.
- `search_layers` gains an optional `province` filter (legacy `provincia` key mapped).
- Generalized catalog builder: WMS merge for all endpoints, WMS-only branch, retry for unstable servers, prefix-tolerant WFS parser.
- Regenerated portal with dynamic labels, counts, filters and licenses.

## [0.1.0] - 2026-10-30

- First public version (as GeoTucumán): xmcp-based MCP server (stdio) with `search_layers`, `suggest_layers`, `describe_layer`, `query_layer` and `geocode`, over the Catastro (DGCT), Geosplan, IGN and RIDES sources; WMS/WFS service-type enum; landing page explaining the MCP with a real Tucumán map.
