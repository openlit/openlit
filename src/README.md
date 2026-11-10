# Testing and Developing Locally

There are two ways to run OpenLIT while you work on it:

- **From source (recommended for code changes):** `scripts/dev-realtime.sh` runs the UI with hot reload, the OTLP receiver, the realtime engine, and NATS on your machine, and starts ClickHouse in Docker if needed. See [Run OpenLIT locally](../CONTRIBUTING.md#run-openlit-locally) and the [Local development](https://docs.openlit.io/latest/openlit/developer-resources/local-development) docs.
- **Docker Compose:** builds the OpenLIT image from this directory and runs it with ClickHouse and NATS. Use it to test the production image or the sample apps. The rest of this guide covers it.

The Compose setup is orchestrated by `dev-docker-compose.yml` and supports two modes:

| Mode | What starts | Use case |
|------|-------------|----------|
| **Default** | ClickHouse + NATS + OpenLIT (UI, OTLP receiver, realtime engine) | Testing the OpenLIT image |
| **Full** (`--profile full`) | + Controller + sample apps (OpenAI, Anthropic, Gemini, CrewAI, OpenAI Agents JS) | Testing the full end-to-end setup |

## Running the Development Environment

1. Open a terminal and `cd` into the `src/` directory.

2. **UI only** — build and start the OpenLIT dashboard:

    ```bash
    docker compose -f dev-docker-compose.yml up --build -d
    ```

3. **Full setup** — also build the controller and sample apps:

    ```bash
    docker compose -f dev-docker-compose.yml --profile full up --build -d
    ```

4. Once the command completes, access the OpenLIT dashboard at http://127.0.0.1:3000 and sign in with `user@openlit.io` / `openlituser`. Send OTLP to `127.0.0.1:4318` (HTTP) or `127.0.0.1:4317` (gRPC) with an API key from **Settings → API Keys**.

## What's included in full mode

| Service | Description |
|---------|-------------|
| **ClickHouse** | Time-series database for telemetry |
| **NATS** | JetStream bus for realtime signals (no published ports) |
| **OpenLIT** | Dashboard, first-party OTLP receiver, and realtime engine for threshold alerts (ports 3000, 4317, 4318) |
| **Controller** | eBPF-based LLM service discovery (built from `openlit-controller/`) |
| **openai-app** | Sample OpenAI chat app (from `examples/`) |
| **anthropic-app** | Sample Anthropic chat app (from `examples/`) |
| **gemini-app** | Sample Gemini chat app (from `examples/`) |
| **crewai-app** | Sample CrewAI agent app (from `examples/`) |
| **openai-agents-js-app** | Sample JavaScript/TypeScript OpenAI Agents SDK app with an in-process mock LLM (from `examples/`) |

## Stopping the environment

```bash
# Stop and remove containers
docker compose -f dev-docker-compose.yml --profile full down

# Also remove stored data (ClickHouse + OpenLIT)
docker compose -f dev-docker-compose.yml --profile full down -v
```

> **Note:** Include `--profile full` in the down command if you started with it, otherwise the profiled services won't be stopped.
