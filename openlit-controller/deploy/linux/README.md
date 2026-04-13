# OpenLIT Controller — Linux Demo

Run the OpenLIT Controller natively on a Linux machine with sample LLM apps. The infrastructure (ClickHouse + OpenLIT dashboard) runs in Docker, while the controller and apps run directly on the host.

The sample apps are shared from the repo's `examples/` folder — the same apps used by all demos.

## What's included

| Component              | Runs on  | Description                               |
|------------------------|----------|-------------------------------------------|
| **ClickHouse**         | Docker   | Time-series database for telemetry        |
| **OpenLIT**            | Docker   | Dashboard + OTLP collector (port 3000)    |
| **Controller**         | Host     | eBPF-based LLM service discovery          |
| **openai-chat-app**    | Host     | Sample app calling OpenAI (from examples/)|
| **anthropic-chat-app** | Host     | Sample app calling Anthropic (from examples/)|
| **gemini-chat-app**    | Host     | Sample app calling Gemini (from examples/)|

## Prerequisites

- **Linux** machine with kernel 5.8+ (Ubuntu 22.04+, Debian 12+, Fedora 37+)
- **Docker** with Docker Compose v2 (for ClickHouse + OpenLIT)
- **Python 3.8+** with pip
- **Root access** (the controller needs eBPF capabilities)
- **Full repo clone** (sample apps are in `examples/`)

## Quick Start

```bash
# 1. Run setup (downloads controller, starts everything)
sudo bash setup.sh

# 2. Open the dashboard
open http://localhost:3000
```

The setup script will:
1. Start ClickHouse + OpenLIT in Docker
2. Download and install the controller binary
3. Start the controller (connects to the dashboard automatically)
4. Start 3 sample Python apps that call OpenAI, Anthropic, and Gemini

Within ~30 seconds, the controller discovers the apps and they appear in **Instrumentation Hub**.

## Check status

```bash
# Dashboard infrastructure
docker compose ps

# Controller process
ps aux | grep openlit-controller

# Sample app processes
ps aux | grep "app.py"

# Controller logs (runs in foreground — check terminal or journal)
sudo journalctl -u openlit-controller -f   # if using systemd
```

## Tear down

```bash
sudo bash teardown.sh
```

This stops all processes and removes the Docker containers + volumes. To also uninstall the controller binary:

```bash
sudo rm /usr/local/bin/openlit-controller
```

## Configuration

### Use your own API keys

Set environment variables before running setup:

```bash
export OPENAI_API_KEY="sk-your-real-key"
export ANTHROPIC_API_KEY="sk-ant-your-real-key"
export GEMINI_API_KEY="your-gemini-key"
sudo -E bash setup.sh
```

### Secure with an API Key

1. Open the dashboard at `http://localhost:3000`
2. Go to **Settings → API Keys** and create a key
3. Restart the controller with the key:

```bash
sudo OPENLIT_URL=http://127.0.0.1:3000 \
     OPENLIT_API_KEY="your-api-key" \
     OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
     openlit-controller
```

### Install as a systemd service (production)

```bash
sudo curl -sSL https://get.openlit.io/controller | sudo bash
```

This installs the controller as a persistent systemd service. See `../install.sh` for details.
