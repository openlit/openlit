# OpenLIT engine

`openlit-engine` evaluates realtime rules against GenAI signals as they are ingested. The OTLP receiver publishes signals to NATS JetStream after each ClickHouse insert, the engine consumes them, and findings are posted back to the OpenLIT UI server, which stores them and shows them on the **Signals** page.

```text
OTLP receiver ──► NATS JetStream (OPENLIT_SIGNALS) ──► openlit-engine ──► /api/internal/realtime/findings
```

## Behaviour

- Signals are consumed with an ordered consumer that starts `ENGINE_REPLAY` in the past, so rule windows are rebuilt after a restart.
- A signal whose payload tenant does not match its subject (`openlit.signal.<organisation>.<project>.<environment>`) is rejected.
- Rules are fetched from `/api/internal/realtime/rules` every `ENGINE_RULES_REFRESH`. Community Edition ships four built-in rules: error rate, p95 latency, token volume, and cost. Their thresholds are set with `OPENLIT_REALTIME_*` variables on the UI server.
- Window rules fire when the metric breaches its threshold with at least `minSamples` samples, and resolve when it recovers. A cooldown suppresses re-firing.
- Findings are delivered with retries. The server re-validates the rule, scope, and tenant before storing anything.
- The engine keeps the latest 500 signals in memory. `GET /signals` returns one tenant's signals and requires the `X-CRON-JOB` secret. The UI proxies this for the Signals inspector.
- Rules can match and group by an allowlist of span attributes (`user.id`, `gen_ai.tool.name`, `gen_ai.request.temperature`, and the other operational fields). `OPENLIT_SIGNAL_ATTRIBUTES` adds keys. Prompt, completion, and message attributes are never copied or matched.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NATS_URL` | required | NATS server URL |
| `NATS_USER` / `NATS_PASSWORD` / `NATS_TOKEN` / `NATS_CREDS` | unset | NATS authentication |
| `OPENLIT_SIGNALS_STREAM` | `OPENLIT_SIGNALS` | JetStream stream name |
| `OPENLIT_URL` | `http://127.0.0.1:3000` | OpenLIT UI server |
| `CRON_JOB_SECRET` | `true` | Shared secret sent as `X-CRON-JOB` to the internal routes |
| `ENGINE_HTTP_ADDR` | `127.0.0.1:4320` | `GET /health`, `GET /stats`, and `GET /signals` |
| `ENGINE_RULES_REFRESH` | `60s` | Rule refresh interval |
| `ENGINE_TICK` | `5s` | Window evaluation interval |
| `ENGINE_REPLAY` | `10m` | How far back to replay on start |

The Docker image starts the engine automatically when `NATS_URL` is set and passes it the persisted `CRON_JOB_SECRET`.

## Local development

From the repository root:

```bash
scripts/dev-realtime.sh
OPENLIT_API_KEY=<key> scripts/dev-realtime-send-spans.py --count 20 --error-rate 1
```

The first command runs the UI, receiver, engine, and NATS together. The second sends erroring GenAI spans, which open an error-rate finding once `OPENLIT_REALTIME_MIN_SAMPLES` (default 20) is reached.

Validate with `go test ./...`.
