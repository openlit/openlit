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

Send `Authorization: Bearer <openlit-api-key>` (or `x-openlit-api-key`). The key is scoped to organisation → project → environment and resolves to the bound `DatabaseConfig` ClickHouse. Client `x-database-config-id` headers are ignored.

A valid key stamps `organisation.environment.name`, `openlit.organisation.id`, and `openlit.project.id`. It does **not** overwrite client `deployment.environment`.

Without a key, data is written to `INIT_DB_*` unless `OTLP_REQUIRE_API_KEY=true`. That fallback does not invent org/project/environment attributes.

## Local next dev

```bash
cd src/otlp-receiver
SQLITE_DATABASE_URL=file:../client/prisma/dev.db \
INIT_DB_HOST=127.0.0.1 INIT_DB_PORT=8123 INIT_DB_DATABASE=openlit \
go run ./cmd/otlp-receiver
```
