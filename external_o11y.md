External Observability Data Sources (Grafana-style datasources for OpenLIT)

Idea (one line)

Make the raw telemetry store pluggable: every read of AI observability data goes through a normalized DataSourceAdapter contract that ClickHouse (default, CE) and external vendors (Datadog, New Relic, Dash0, Grafana, Prometheus/Loki/Tempo — EE) implement, so Telemetry, Agents, Evals, and Dashboards can be powered by "the Datadogs of the world" while OpenLIT keeps only derived/eval data.

Feasibility verdict

Feasible, but it is a large, cross-cutting refactor. The whole app currently funnels observability reads through one function, dataCollector() in src/client/src/lib/platform/common.ts, executing raw ClickHouse SQL across ~286 call sites in ~68 files. That single choke point is the leverage: it becomes the seam for a normalized query layer. The two hard realities to design around:





Vendors differ wildly (SQL vs TraceQL vs PromQL vs LogQL vs Datadog API vs NRQL) and have very different aggregation power. This is handled by a normalized query model + per-adapter translation + explicit capability negotiation.



The Agents page depends on a ClickHouse materializer writing openlit_agents_summary; it cannot materialize into a vendor. Solution: the materializer reads via the adapter and keeps writing derived rows to OpenLIT's own ClickHouse app store.

Core architectural decision: split "app store" from "telemetry source"

Today DatabaseConfig (Postgres) is implicitly a single ClickHouse used for BOTH:





OpenLIT-owned/derived data: openlit_agents_summary, openlit_agent_versions, openlit_evaluation, openlit_board/widget, rules, prompts, vault, controller tables.



Raw telemetry: otel_traces, otel_logs, otel_metrics_*.

We split these two roles:





App/derived store: stays OpenLIT-owned ClickHouse (unchanged). Eval results, agent summaries, dashboards, versions keep living here. This satisfies "eval data stays with us."



Telemetry source: pluggable per project (and per widget). Default = the same ClickHouse; optionally an external vendor.

Only raw-telemetry reads become adapter-routed. Derived writes/reads stay as-is. A fully "no ClickHouse at all" deployment (moving openlit_* to Postgres) is explicitly out of scope for now.

Grafana concepts we borrow (from backend research)





Per-type backend adapter with a uniform query entry point (Grafana QueryData), returning a normalized columnar result ("data frames").



Instance settings carrying decrypted secure config per configured source.



Capability-based: each source declares which signals/operations it supports; UI degrades gracefully.



Query pushdown to the vendor; a server-side proxy for auth + SSRF safety.

Target architecture

flowchart TD
  subgraph surfaces [OpenLIT surfaces]
    Tel[Telemetry pages]
    Ag[Agents materializer + graph]
    Ev[Evals]
    Dash[Dashboard widgets]
  end
  surfaces --> QL[Normalized query: OpenLITQuery + AITelemetrySelector]
  QL --> REG[Adapter registry + capability negotiation]
  REG --> CH[ClickHouse adapter - CE default]
  REG --> EXT[External adapters - EE]
  EXT --> DD[Datadog]
  EXT --> NR[New Relic]
  EXT --> D0[Dash0]
  EXT --> GRAF[Grafana: metrics/logs/traces sub-sources]
  EXT --> CUST[Custom: Prometheus / Loki / Tempo / Jaeger]
  CH --> CHDB[(OpenLIT ClickHouse: otel_* AND derived openlit_*)]
  EXT -->|read raw o11y only| VEND[(Vendor stores)]
  Ag --> APPSTORE[(Derived data stays in OpenLIT ClickHouse)]
  Ev --> APPSTORE

1. Normalized query contract (CE, new)

New module (e.g. src/client/src/lib/platform/datasource/) defining vendor-agnostic types:





Signal = "traces" | "logs" | "metrics".



AITelemetrySelector: the "only AI data" predicate — presence of gen_ai.*, coding_agent.*, gen_ai.agent.*, and/or the explicit marker ResourceAttributes['telemetry.sdk.name'] = 'openlit'. Each adapter translates this to its native filter. Seed it from the existing selectors in snapshot.ts and materialize.ts.



OpenLITQuery: { signal, timeRange, filters (normalized attribute predicates over gen_ai.*/service/status), groupBy, aggregations, sort, limit/offset, aiSelector }. Attribute naming is OTel semconv, reusing the mapping in constants/traces.ts (TraceMapping) and helpers/client/trace.ts.



DataFrame: normalized columnar result (fields + rows + meta) that widgets/pages consume, replacing the raw JSONEachRow assumption.



DataSourceAdapter interface with capability flags and methods:





traces: listSpans, getSpan, getTraceSpans (parent/child tree), aggregateSpans, spanTimeSeries, distinctValues, attributeKeys.



logs: listLogs, logTimeSeries, logAttributeKeys.



metrics: listMetricSeries, metricTimeSeries, metricAttributeKeys.



discovery (agents): discoverServices(range), aggregateByService(range).



healthCheck(), capabilities().

2. Adapter registry + CE/EE extension hook





CE registry that always contains the ClickHouse adapter, plus a neutral extension hook getExternalDataSourceAdapters() returning [] in CE (mirrors the export const enterpriseStoreSlices = {} pattern in src/client/src/store/enterprise.ts and no-op route-access.ts).



EE (openlit-enterprise/src/client/src/ee/**) overrides the hook to register vendor adapters. No @/ee/** import ever appears in CE.



Capability negotiation: pages ask the registry "does the selected source support signal X / operation Y?"; if not, show a clear "not supported by this data source" state (e.g., Prometheus can't power the traces tab or the agent graph).

3. ClickHouse adapter (CE) — the reference implementation





Implement DataSourceAdapter for ClickHouse by moving the existing SQL builders behind the interface methods (reuse getFilterWhereCondition, request/index.ts, observability.ts, aggregate-graph.ts).



Keep a ClickHouse-only "raw SQL" escape hatch internally for back-compat with existing raw-SQL dashboard widgets (see section 6), but the cross-source path is the structured OpenLITQuery.



Full-capability source (all signals, aggregation, trace tree).

4. Telemetry source config + selection (config model)





New Postgres model TelemetrySource (project-scoped, next to DatabaseConfig): { id, projectId, name, type (clickhouse|datadog|newrelic|dash0|grafana|prometheus|loki|tempo|jaeger), signals[], settings (JSON, non-secret: URLs/site/orgId), secretRef (vault id), isDefault }.



One implicit built-in source per project = "OpenLIT ClickHouse" (the current DatabaseConfig).



Secrets (API keys) via the existing vault (openlit_vault) + encryption, never in settings.



Selection precedence: per-widget override -> per-page/project default -> built-in ClickHouse. Extend the dashboard widget config (see the ClickHouse openlit_widget schema in create-custom-dashboards-migration.ts) with an optional sourceId, and add a project default.



CRUD + management UI is EE-gated; CE ships only the neutral TelemetrySource contract/types and the resolver that defaults to ClickHouse.

5. Per-surface changes





Telemetry (observability/signal-list.tsx + /api/metrics/**, /api/telemetry/**): route list/summary/detail/attribute-key calls through the resolved adapter; render DataFrame. Trace detail (getTraceSpans) requires trace-tree capability.



Agents: keep the materializer as the sole raw-telemetry consumer, but have it read via the adapter (discoverServices, aggregateByService, deriveSnapshot inputs) and keep WRITING openlit_agents_summary/openlit_agent_versions to OpenLIT's ClickHouse app store. The agent graph (aggregate-graph.ts) needs getTraceSpans/aggregateSpans and only works on trace-capable sources.



Evals (evaluation/index.ts): fetch span-for-eval and auto-eval candidate spans via the adapter (getSpan, listSpans filtered to gen_ai.operation.name='chat'); keep storing results in openlit_evaluation (OpenLIT store).



Dashboards (widget.ts runWidgetQuery + /api/manage-dashboard/query/run): resolve the widget's sourceId, translate the widget's structured query via the adapter. ClickHouse widgets may retain raw SQL (CH-only) for back-compat.

6. Backward-compat / migration strategy (the ~286 call sites)





Introduce the interface with the ClickHouse adapter first (zero behavior change; CE keeps working ClickHouse-only).



Migrate surface-by-surface (Telemetry -> Evals -> Agents -> Dashboards), not all at once.



Existing raw-SQL widgets keep working through the ClickHouse adapter's raw mode; only new/external widgets require the structured query model. Note explicitly: "adapter-only, no native query editors" applies to the cross-vendor UX; ClickHouse retains a raw-SQL power-user path.

7. Production-at-scale hardening





Query pushdown: always push filters/aggregations/time-bucketing to the vendor; never pull raw spans into Node to aggregate.



Caching: reuse the agents SWR cache pattern; add a per-source query cache keyed on {sourceId, query hash, timeRange} with short TTLs.



Rate limiting + budgets + backoff for metered vendor APIs (Datadog/New Relic); concurrency caps (Grafana caps at ~10 concurrent).



SSRF/security: user-supplied URLs (custom Prometheus/Loki/Tempo, Grafana) must be validated against an allowlist and routed through a server-side proxy; block internal/link-local ranges; enforce the F4 URL rules. Secrets decrypted server-side only.



Timeouts, pagination/cursor normalization, max time-range guards, downsampling.



Field mapping layer per vendor -> OTel gen_ai.* semconv (Datadog/NR rename attributes).



Query observability: log/trace each adapter query (source, latency, rows, cost) for debugging and quota visibility.

8. Vendor capability tiers (guides phasing)





Full (traces+logs+metrics, strong aggregation, trace tree): ClickHouse (CE), Datadog, New Relic, Dash0.



Traces (list/tree; weak native aggregation -> some aggregations degraded or client-side within caps): Tempo, Jaeger.



Logs only: Loki.



Metrics only (powers metric widgets + metric tabs, NOT traces/agents): Prometheus, Mimir.



Grafana = umbrella that fans out to metrics/logs/traces sub-sources (Grafana datasource proxy or direct Mimir/Loki/Tempo).

Risks / open questions





Aggregation gaps on trace-only backends (Tempo/Jaeger) limit how much of Telemetry/Agents they can power; capability negotiation must make this explicit in the UI.



Latency/cost of external APIs vs local ClickHouse; caching is mandatory.



Dash0 query API surface needs verification (OTel-native, but confirm the read API before building its adapter).



"adapter-only, no native editors" vs existing raw-SQL widgets: confirm the ClickHouse raw-SQL escape hatch is acceptable, or we must migrate all seeded/user widgets to structured queries (larger lift).



Enterprise gating: confirm the exact feature key + which plans get which vendors.

