# OpenLIT OTLP receiver

First-party OTLP HTTP (:4318) and gRPC (:4317) ingest that writes ClickHouse `otel_*` tables.

## Endpoints

- `POST /v1/traces`, `POST /v1/metrics`, `POST /v1/logs` (protobuf or JSON, gzip optional)
- gRPC OTLP on `:4317`
- `GET /health`

The OpenLIT UI proxies the same `/v1/*` paths from the app origin to this process.

## Tenant routing

Send `Authorization: Bearer <openlit-api-key>`. The key is scoped to organisation → project → environment and resolves to the bound `DatabaseConfig` ClickHouse. Client `x-database-config-id` headers are ignored. Ingest overwrites `deployment.environment` (and fills `openlit.organisation.id` / `openlit.project.id`) from the key.

Without a key, data is written to `INIT_DB_*` unless `OTLP_REQUIRE_API_KEY=true`. That fallback does not invent org/project/environment attributes.

## Local next dev

```bash
cd src/otlp-receiver
SQLITE_DATABASE_URL=file:../client/prisma/dev.db \
INIT_DB_HOST=127.0.0.1 INIT_DB_PORT=8123 INIT_DB_DATABASE=openlit \
go run ./cmd/otlp-receiver
```
