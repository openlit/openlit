# OpenLIT engine

`openlit-engine` evaluates realtime rules against GenAI signals as they are ingested. The OTLP receiver publishes signals to NATS JetStream after each ClickHouse insert, the engine consumes them, and findings are posted back to the OpenLIT UI server, which stores them and shows them under **Alerts**.

```text
OTLP receiver ──► NATS JetStream (OPENLIT_SIGNALS) ──► openlit-engine ──► /api/internal/realtime/findings
```

## Behaviour

- Signals are consumed with an ordered consumer that starts `ENGINE_REPLAY` in the past, so rule windows are rebuilt after a restart.
- A signal whose payload tenant does not match its subject (`openlit.signal.<organisation>.<project>.<environment>`) is rejected.
- Rules are fetched from `/api/internal/realtime/rules` every `ENGINE_RULES_REFRESH`. Rules are stored per organisation, project, and environment and owned by a product feature (today, threshold alerts: ids `alert.<id>`). Nothing is evaluated until a rule exists; the `OPENLIT_REALTIME_*` variables only seed the alert templates.
- Window rules fire when the metric breaches its threshold with at least `minSamples` samples, and resolve when it recovers. A cooldown suppresses re-firing.
- Findings are delivered with retries. The server re-validates the rule, scope, and tenant before storing anything.
- The engine keeps the latest 200 signals per tenant (organisation, project, environment) for up to 1,000 tenants. `GET /signals` returns one tenant's signals. The UI proxies this for the live spans on an alert's detail page.
- Environments are lowercased; signals whose environment is not a valid OpenLIT environment name are dropped and counted.
- Rules can match and group by an allowlist of operational span attributes (`gen_ai.tool.name`, `gen_ai.request.temperature`, `http.route`, and similar). `OPENLIT_SIGNAL_ATTRIBUTES` adds keys. User, session, and conversation ids, `url.path`, and `server.address` are personal or sensitive and only allowed when listed there. Prompt, completion, and message attributes are never copied or matched.

## Security and limits

- `OPENLIT_ENGINE_SECRET` is required; the engine exits without it. It is sent as `X-OpenLIT-Engine-Secret` to the internal routes, and every engine API call except `/health` must present it. It is separate from `CRON_JOB_SECRET`.
- Group values come from span data, so state is capped: windows per tenant and in total, samples per window, and findings opened per tenant per minute. Excess is dropped and counted in `/stats`. Idle windows are evicted. Resolutions are never rate-limited.
- Findings are handed to the delivery queue after the evaluation lock is released.
- The engine connects to NATS with its own user (`NATS_ENGINE_USER`), which `assets/nats.conf` limits to reading the signal stream; it cannot publish signals.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NATS_URL` | required | NATS server URL |
| `NATS_ENGINE_USER` / `NATS_ENGINE_PASSWORD` / `NATS_ENGINE_TOKEN` / `NATS_ENGINE_CREDS` | falls back to `NATS_USER` / `NATS_PASSWORD` / `NATS_TOKEN` / `NATS_CREDS` | NATS authentication |
| `NATS_TLS_CA` / `NATS_TLS_CERT` / `NATS_TLS_KEY` | unset | CA bundle and client certificate (mTLS) for NATS |
| `NATS_TLS_REQUIRED` | `false` | Refuse non-TLS NATS connections |
| `OPENLIT_SIGNALS_STREAM` | `OPENLIT_SIGNALS` | JetStream stream name |
| `OPENLIT_URL` | `http://127.0.0.1:3000` | OpenLIT UI server |
| `OPENLIT_ENGINE_SECRET` | required | Shared secret with the UI server |
| `ENGINE_HTTP_ADDR` | `127.0.0.1:4330` | `GET /health`, `GET /stats`, and `GET /signals`. Keep it on loopback |
| `OPENLIT_ENGINE_MAX_WINDOWS` | `50000` | Rule windows across all tenants |
| `OPENLIT_ENGINE_MAX_WINDOWS_PER_TENANT` | `1000` | Rule windows per organisation/project/environment |
| `OPENLIT_ENGINE_MAX_SAMPLES_PER_WINDOW` | `5000` | Samples kept per window |
| `OPENLIT_ENGINE_FINDINGS_PER_MIN` | `60` | Findings a tenant can open per minute |
| `ENGINE_RULES_REFRESH` | `60s` | Rule refresh interval |
| `ENGINE_TICK` | `5s` | Window evaluation interval |
| `ENGINE_REPLAY` | `10m` | How far back to replay on start |

The Docker image starts the engine automatically when `NATS_URL` is set, and generates and persists `OPENLIT_ENGINE_SECRET` for both the engine and the UI server.

## Local development

From the repository root:

```bash
scripts/dev-realtime.sh
OPENLIT_API_KEY=<key> scripts/dev-realtime-send-spans.py --count 20 --error-rate 1
```

The first command runs the UI, receiver, engine, and NATS together. The second sends erroring GenAI spans, which open an error-rate finding once `OPENLIT_REALTIME_MIN_SAMPLES` (default 20) is reached.

Validate with `go test ./...`.
