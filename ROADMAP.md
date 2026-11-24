# GeoArg roadmap: from discovery to a reliable contract

Updated: 24 November 2026. Priorities, not release dates. Tracks issue #63.

## Baseline checked

- Package version: 0.3.1. Embedded catalog: 3,649 layers from 26 sources, generated 13 November 2026. Coverage wording in the repository: 23/24 jurisdictions; this is catalog coverage, not a guarantee of data throughout each territory.
- Public HTTP endpoint exposes six main tools: search_layers, suggest_layers, describe_layer, query_layer, geocode and report_miss, plus four deprecated Spanish aliases. report_miss is HTTP-only.
- MiniSearch relevance index, Spanish stemming, client-provided relatedTerms, curated per-layer aliases and the deterministic report_miss workflow already exist. Do not replace them with a hardcoded topic dictionary.
- Daily health workflow exists. The checked-in report dated 18 November 2026 records 3,403/3,649 responding layers (93.26%). It is not a current availability guarantee.
- The published fire/water example is a saved analysis generated 11 November. Fire records are fallback fixtures dated 10 November. Its spatial calculations run outside the MCP tools.

## First delivery: clear, honest discovery

Prepared in this change:
- search_layers and suggest_layers: top 5 by default, configurable limit 1–20, minScore and rank/score; results grouped by source without removing the flat lists.
- Explicit province filter for suggestions and filter-aware lexical noCoverage.
- Reject matches supported only by province/source index fields. This is a limited noise guard, not semantic understanding.
- Discovery status and an explicit cannot-answer-analysis contract. Finding metadata does not prove current fires, proximity or absence of a phenomenon.
- Advertised WMS display versus vector-query capabilities, unknown data dates and live status, and conservative temporal readiness.
- Successful empty feature queries explain that bbox, CRS, paging and actual coverage still need checking.
- The fire example prominently labels fallback data and separates the external analysis from MCP discovery.

Acceptance: existing offline validation/build/Worker checks pass; focused real-catalog calls verify limits, thresholds, filters, stale WMS warnings and honest no-match handling. Merge only after green GitHub CI; public availability requires deployment verification.

## Next: measurable relevance and usable data

1. Assemble 50 genuinely observed Spanish/English queries with reviewed relevant-layer labels. Publish a baseline before claiming 90% top-5 relevance. Expand existing deterministic checks only where they catch an actual regression.
2. Evaluate exact service-identity deduplication, calibrated thresholds and source diversity. A raw MiniSearch score is not a probability and is not comparable across arbitrary queries.
3. Validate geometries and sample bounding boxes before calling a layer analyzable. Separate display, attributes and vector geometry; expose actual coverage notes. Investigate GetFeatureInfo per WMS capability, not as a universal vector replacement.
4. Validate a near-real-time fire source and its license, observation timestamps and geographic coverage. Do not label MODIS fixtures or undated snapshots as today's data.

## Then: reliability and bounded spatial work

- Structured error codes/hints and a shared paging contract; distinguish an empty successful response from a failed service.
- Endpoint timeout/retry/cache budgets and observable degradation. Review existing health/refresh workflows before adding new automation.
- Consider nearest, within_km and intersects only with verified geometries, CRS, bounded feature counts and explicit units. Keep analysis external until these operators are actually implemented and tested.
- Audit report_miss deployment and abuse limits without filing artificial public reports. Keep ambiguous fixes in triage and require green CI before automatic merge.

## 1.0 exit criteria

Stable schemas and alias deprecation policy; measured relevance; explained empty results; verified capability/freshness semantics; separate live/offline validation; per-tool reproducible examples and license notes. No 1.0 claim until these checks are met.

## Coverage and research

Formosa remains an integration gap in the checked repository. Recheck its official services from a permitted working route, validate capabilities and licenses, then integrate through PR. The historical diagnosis suggests network/server filtering; its exact cause and current behavior must not be asserted without a fresh check.

After the presentation, turn the existing system and applied case into a paper: method, reproducible catalog, benchmark, dependency failures and limitations. Francisco owns the academic writing and requirements; no format, deadline or venue is assumed here.

## Not promised in this delivery

A validated 50-query benchmark, current fire ingestion, generalized geometryless ArcGIS handling, new spatial operators, full live error-envelope migration, nationwide data completeness or a production 1.0 release. No paid tools, hosted copy of source geodata or server-side LLM.

## Evidence

- Issue: https://github.com/FranprzDev/geotucuman/issues/63
- Repository: https://github.com/FranprzDev/geotucuman
- Public MCP: https://geoarg-mcp.franprzdev.workers.dev/mcp
- Saved example: https://franprzdev.github.io/geotucuman/ejemplos/focos-tucuman.html
- Health: https://franprzdev.github.io/geotucuman/salud.html
