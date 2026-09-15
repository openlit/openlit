# Datasource module — add-a-datasource checklist

This layer is **datasource-agnostic**: OpenLIT talks to any external telemetry
vendor (Grafana LGTM today; dash0, Honeycomb, or any OTLP vendor later) through
one adapter + a self-describing descriptor. The shared forms, query planner,
Prisma schema, and every UI surface are driven by that descriptor, so **adding a
new datasource must not require editing shared forms, the planner, the schema,
or any UI** — and needs no Prisma migration (`type` stays a free string).

## What a new datasource needs (and nothing more)

1. **`datasource/<vendor>/adapter.ts`** — a class extending `BaseExternalAdapter`
   that implements the `DataSourceAdapter` methods its `capabilities()`
   advertises. Reuse `otlp-json.ts` for OTLP trace/log parsing, `http/safe-fetch`
   for every outbound call (SSRF-safe, default-deny), and `http/cache` for
   response caching. Methods for unsupported capabilities should throw
   `UnsupportedCapabilityError` (the UI gates them into honest "not supported"
   states automatically).
2. **A `describe(): SourceTypeDescriptor`** on the factory. This is the single
   source of truth for the add/edit form. Set:
   - `type`, `displayName`, `declaredSignals`, `capabilities`, `correlation`
   - `configFields` — reuse `config-fields.ts` helpers (`httpVendorFields`,
     `endpointField`, `httpAuthFields`, `tenantField`) so labels come from
     `constants/messages/en.ts` (no hard-coded strings)
   - `authStyle` (`"none" | "http" | "api-key" | "custom"`), optional `authHelp`
     and `docsUrl` — the form renders credential hints from these, not from
     `type === "<vendor>"` branches
   - optional `maxDataPoints` / `maxLookbackMs` capability hints (adapters that
     omit these still work — the contract stays simple)
3. **`datasource/<vendor>/selector.ts`** (for query languages) — translate the
   shared AI selector (`ai-selector.ts`) into the vendor query language
   (TraceQL, …). Push aggregation down to the vendor; never
   pull raw rows to aggregate in-process.
4. **Register the factory** in `bootstrap.ts` (`VENDOR_FACTORIES`), or ship it
   from the private repo via the `getExternalDataSourceAdapters()` hook for
   EE-only vendors.

## What you must NOT touch

- No new form fields in `data-sources-page.tsx` — it renders `configFields`.
- No Prisma migration or enum — `type` is a free string.
- No per-vendor `switch` anywhere — capability gating + descriptors handle it.
- No `@/ee/**` import from CE; keep vendor strings in `constants/messages/en.ts`.

## Verify extensibility (the dash0 readiness test)

A fictional descriptor-only type with only `configFields` renders end to end,
and the same-shaped adapter test used for `tempo` / `jaeger` passes for any new
OTLP vendor. If your new adapter needs an edit outside `datasource/<vendor>/**`
(plus one line in `bootstrap.ts`), the extensibility contract has regressed —
fix the shared layer, not the vendor.

## Performance contract (Grafana parity)

- **Push-down aggregation**: counts/rates/histograms run in the vendor, not here.
- **Pixel-bounded downsampling**: honor `OpenLITQuery.maxDataPoints`; compute
  `interval/step` via `downsample.ts` (Grafana math) and clamp point counts.
- **Instant vs range**: single-value/table views use instant queries, series use
  range queries.
- **Budgets**: every read passes through `clampQueryBudget` (`maxRows`,
  `maxRangeMs`, `maxLookbackMs`) so no query can trigger an unbounded scan.
- **Resilience**: reads use `concurrencyKey` + `retry` + per-query `timeoutMs`,
  and tag heavy queries with `X-Query-Tags` for ops guardrails.

## OpenPlait-backed ClickHouse reads

The built-in ClickHouse connector uses the generic OpenPlait runtime and
`@openplait/adapter-clickhouse` at `lib/platform/openplait`. The shared
`dataCollector` routes product read-only ClickHouse queries through that
boundary. The traces/logs/metrics facades never branch around the resolved
adapter for built-in ClickHouse. Inserts, migrations, commands, and other
mutations intentionally keep the existing ClickHouse client path.

OpenLIT's internal intelligence layer is a deliberate exception. Otter,
AI-analysis/coding-agent materialization, and telemetry rollup tables use
`intelligenceDataCollector`, which talks to OpenLIT's own ClickHouse state
directly and is not a routed datasource signal read.

## Signal-read debugging map

Use these exact files as breakpoints, in order:

| Signal | HTTP entry | Product facade |
| --- | --- | --- |
| Traces | `src/app/api/metrics/request/route.ts` (served as `/api/telemetry/request` by `src/app/api/telemetry/[...segments]/route.ts`) | `src/lib/platform/traces/read.ts` |
| Logs | `src/app/api/telemetry/logs/route.ts` | `src/lib/platform/logs/read.ts` |
| Metrics | `src/app/api/telemetry/metrics/route.ts` | `src/lib/platform/metrics/read.ts` |
| Summaries | `src/app/api/telemetry/summary/[signal]/route.ts` | the same signal facade above |

All three then enter:

1. `src/lib/platform/connectors/datasource/facade.ts` — resolves the current
   project/environment signal binding.
2. `src/lib/telemetry-source.ts` — constructs the selected adapter.
3. `src/lib/platform/connectors/datasource/clickhouse/adapter.ts` for built-in
   ClickHouse, or the selected external adapter (for example
   `grafana/tempo.ts`).
4. Built-in ClickHouse reads enter `src/lib/platform/common.ts::dataCollector`
   and finally `src/lib/platform/openplait/index.ts::executeOpenPlaitRead`.

Interactive signal reads can use the short-lived, source-scoped in-memory
cache in `datasource/http/cache.ts`; Tempo also keeps a bounded in-memory span
index for detail navigation. These caches do not persist datasource rows.
Persisted rollup/hot-cache tables belong to the internal intelligence layer and
are not read by the interactive trace facade.

The OpenPlait runtime registry is generic and keyed by datasource
configuration. ClickHouse reads use the shared runtime, while the Tempo bridge
uses `@openplait/adapter-tempo` for bounded TraceQL search, trace detail
normalization, tag discovery, build/version inspection, and TraceQL metrics.
Unknown Tempo versions use conservative syntax; `most_recent` is enabled only
after a 2.8+ health probe or an explicit setting. Metrics windows are chunked
separately from trace-search windows because Tempo applies different limits.
OpenLIT retains its SSRF-safe transport, credential resolution, caching, and
product-specific aggregation layer. External trace resolution fails closed:
an unavailable Tempo source is never interpreted as permission to read the
built-in ClickHouse `otel_traces` table.
