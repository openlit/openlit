# OpenLIT Controller — Docker Demo

Run the full OpenLIT stack with the Controller and sample LLM apps in Docker. All images are **built from source** — no pre-built images are pulled.

The sample apps are shared from the repo's `examples/` folder — the same apps used by all demos.

## What's included

| Service                | Description                                     |
|------------------------|-------------------------------------------------|
| **ClickHouse**         | Time-series database for telemetry              |
| **OpenLIT**            | Dashboard + OTLP collector (port 3000)          |
| **Controller**         | eBPF-based LLM service discovery                |
| **openai-chat-app**    | Sample app calling OpenAI (from examples/)      |
| **anthropic-chat-app** | Sample app calling Anthropic (from examples/)   |
| **gemini-chat-app**    | Sample app calling Gemini (from examples/)      |
| **crewai-agent-app**   | Sample CrewAI agent app (from examples/)        |

## Prerequisites

- Docker Engine 20.10+ with Docker Compose v2
- Linux host (eBPF requires a Linux kernel — Docker Desktop on macOS/Windows runs a Linux VM, which works)
- **Full repo clone** (images are built from source)

## Quick Start

```bash
# 1. Start everything (builds all images from source)
docker compose up -d --build

# 2. Wait ~30 seconds for services to initialize, then open the dashboard
open http://localhost:3000
```

The Controller will automatically discover the sample apps making LLM API calls and show them on the **Agents** page.

## Check status

```bash
# View all containers
docker compose ps

# View controller logs
docker compose logs openlit-controller -f

# View a sample app's logs
docker compose logs openai-app -f
```

## Tear down

```bash
# Stop and remove all containers + networks
docker compose down

# Also remove stored data (ClickHouse + OpenLIT)
docker compose down -v
```

## Configuration

### Use your own API keys

Edit the `docker-compose.yaml` and replace `demo-key` with real keys:

```yaml
openai-app:
  environment:
    OPENAI_API_KEY: "sk-your-real-key"
```

### Secure with an API Key

1. Open the dashboard at `http://localhost:3000`
2. Go to **Settings → API Keys** and create a key
3. Add it to the controller in `docker-compose.yaml`:

```yaml
openlit-controller:
  environment:
    OPENLIT_API_KEY: "your-api-key"
```

4. Restart: `docker compose up -d openlit-controller`
