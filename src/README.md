# Testing and Developing Locally

This guide covers the steps needed to set up the development environment for OpenLIT using Docker Compose. The setup is orchestrated by `dev-docker-compose.yml` and supports two modes:

| Mode | What starts | Use case |
|------|-------------|----------|
| **Default** | ClickHouse + OpenLIT UI | Working on the OpenLIT dashboard/UI |
| **Full** (`--profile full`) | + Controller + sample apps (OpenAI, Anthropic, Gemini, CrewAI) | Testing the full end-to-end setup |

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

4. Once the command completes, access the OpenLIT dashboard at http://127.0.0.1:3000.

## What's included in full mode

| Service | Description |
|---------|-------------|
| **ClickHouse** | Time-series database for telemetry |
| **OpenLIT** | Dashboard + OTLP collector (port 3000) |
| **Controller** | eBPF-based LLM service discovery (built from `openlit-controller/`) |
| **openai-app** | Sample OpenAI chat app (from `examples/`) |
| **anthropic-app** | Sample Anthropic chat app (from `examples/`) |
| **gemini-app** | Sample Gemini chat app (from `examples/`) |
| **crewai-app** | Sample CrewAI agent app (from `examples/`) |

## Stopping the environment

```bash
# Stop and remove containers
docker compose -f dev-docker-compose.yml --profile full down

# Also remove stored data (ClickHouse + OpenLIT)
docker compose -f dev-docker-compose.yml --profile full down -v
```

> **Note:** Include `--profile full` in the down command if you started with it, otherwise the profiled services won't be stopped.
