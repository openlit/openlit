# OpenLIT OTLP receiver

First-party OTLP HTTP (`:4318`) and gRPC (`:4317`) ingest that writes ClickHouse `otel_*` tables. The OpenLIT image no longer ships the OpenTelemetry Collector.

## Endpoints

- `POST /v1/traces`, `POST /v1/metrics`, `POST /v1/logs` (protobuf or JSON, gzip optional)
- gRPC OTLP on `:4317`
- `GET /health`

The OpenLIT UI proxies the same `/v1/*` paths from the app origin to this process.

Supported metric types: gauge, sum, histogram, summary, and exponential histogram (`otel_metrics_*` tables).

On first ingest, and again if an insert fails because `otel_*` tables were dropped, the receiver runs `CREATE TABLE IF NOT EXISTS` for the OTLP schema and retries the write once. Compose/Kubernetes ClickHouse init scripts still create the same tables on an empty volume.

## Tenant routing

Send `Authorization: Bearer <openlit-api-key>` (or `x-openlit-api-key`). The key resolves to its bound `DatabaseConfig` ClickHouse, and that `DatabaseConfig` is authoritative for the project and environment. A key whose project or organisation disagrees with its `DatabaseConfig` is rejected. Client `x-database-config-id` headers are ignored. Unknown keys are cached as negative results for 10 seconds.

A valid key stamps `organisation.environment.name`, `openlit.organisation.id`, and `openlit.project.id`. It does **not** overwrite client `deployment.environment`. The UI applies the same project and environment as a read filter on every `otel_*` query, so projects that share one ClickHouse stay isolated.

Without a key, data is written to `INIT_DB_*` unless `OTLP_REQUIRE_API_KEY=true`. That fallback does not invent org/project/environment attributes.

## Realtime fan-out

When `NATS_URL` is set, the receiver publishes a compact signal for each GenAI span to NATS JetStream after the ClickHouse insert succeeds. The `openlit-engine` (`src/engine`) consumes those signals and evaluates realtime rules. Publishing never blocks ingest: when the buffer is full, signals are dropped and counted.

- Subject: `openlit.signal.<organisation>.<project>.<environment>`
- Message ID: `<trace_id>:<span_id>`, deduplicated by JetStream for 2 minutes
- Only spans sent with a scoped API key are published. Requests without a key, or keys whose `DatabaseConfig` has no project, are written to ClickHouse but not published.
- `GET /stats` on the HTTP port reports fan-out and publish counters.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NATS_URL` | unset (disabled) | NATS server URL |
| `NATS_USER` / `NATS_PASSWORD` / `NATS_TOKEN` / `NATS_CREDS` | unset | NATS authentication |
| `OPENLIT_SIGNALS_STREAM` | `OPENLIT_SIGNALS` | JetStream stream name |
| `OPENLIT_SIGNALS_MAX_AGE` | `10m` | Stream retention, which is also the engine's replay window |
| `NATS_PUBLISH_BUFFER` | `10000` | In-memory publish buffer |
| `NATS_ENSURE_STREAM` | `true` | Create or update the stream on startup |

## Local next dev

To run the UI, receiver, engine and NATS together, use `scripts/dev-realtime.sh` from the repository root. To run the receiver on its own:

```bash
cd src/otlp-receiver
SQLITE_DATABASE_URL=file:../client/prisma/dev.db \
INIT_DB_HOST=127.0.0.1 INIT_DB_PORT=8123 INIT_DB_DATABASE=openlit \
go run ./cmd/otlp-receiver
```
