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
   (TraceQL, LogQL, PromQL, NRQL, …). Push aggregation down to the vendor; never
   pull raw rows to aggregate in-process.
4. **Register the factory** in `bootstrap.ts` (`VENDOR_FACTORIES`), or ship it
   from the private repo via the `getExternalDataSourceAdapters()` hook for
   EE-only vendors. Multi-signal "stack" umbrellas are descriptor-only factories
   in `stacks.ts` (`internal: true` + `stackTemplate`).

## What you must NOT touch

- No new form fields in `data-sources-page.tsx` — it renders `configFields`.
- No `TELEMETRY_STACK_TEMPLATES` / CRUD edits — stacks come from descriptors.
- No Prisma migration or enum — `type` is a free string.
- No per-vendor `switch` anywhere — capability gating + descriptors handle it.
- No `@/ee/**` import from CE; keep vendor strings in `constants/messages/en.ts`.

## Verify extensibility (the dash0 readiness test)

A fictional descriptor-only type with only `configFields` renders end to end,
and the same-shaped adapter test used for `tempo` / `datadog` passes for any new
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
