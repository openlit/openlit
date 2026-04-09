# OpenLIT Kubernetes Example

A complete local Kubernetes setup with all OpenLIT components and sample LLM apps.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Kind Cluster (openlit-demo)                                    │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│  │  ClickHouse  │◄──│ OTEL         │◄──│ OpenLIT Controller │  │
│  │  (StatefulSet)│   │ Collector    │   │ (DaemonSet, eBPF)  │  │
│  └──────┬───────┘   └──────────────┘   └─────────┬──────────┘  │
│         │                                         │ discovers   │
│  ┌──────┴───────┐                                 │             │
│  │   OpenLIT    │   ┌─────────────────────────────┼───────┐     │
│  │  Dashboard   │   │ Sample Apps                 ▼       │     │
│  │  (port 3000) │   │ ┌─────────┐ ┌───────────┐          │     │
│  └──────────────┘   │ │ OpenAI  │ │ Anthropic │          │     │
│                     │ ├─────────┤ ├───────────┤          │     │
│                     │ │ Bedrock │ │  Gemini   │          │     │
│                     │ └─────────┘ └───────────┘          │     │
│                     └────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Kind | Image |
|-----------|------|-------|
| ClickHouse | StatefulSet | `clickhouse/clickhouse-server:24.4.1` |
| OTEL Collector | Deployment | `opentelemetry-collector-contrib:0.98.0` |
| OpenLIT Dashboard | Deployment | `ghcr.io/openlit/openlit:latest` |
| OpenLIT Controller | DaemonSet | `ghcr.io/openlit/openlit-controller:latest` |
| OpenAI App | Deployment | Built locally |
| Anthropic App | Deployment | Built locally |
| Bedrock App | Deployment | Built locally |
| Gemini App | Deployment | Built locally |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) (Kubernetes in Docker)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)

## Quick Start

### 1. Run the setup script

```bash
./setup.sh
```

This will:
- Create a Kind cluster named `openlit-demo`
- Build the 4 sample app Docker images
- Load them into the Kind cluster
- Apply all Kubernetes manifests

### 2. Set your API keys

The sample apps need real API keys to make successful LLM calls (they will still be discovered by the controller without valid keys, just with HTTP errors).

```bash
# Edit the secret directly
kubectl edit secret llm-api-keys -n openlit

# Or patch individual keys (base64 encoded)
kubectl patch secret llm-api-keys -n openlit -p \
  '{"stringData":{"OPENAI_API_KEY":"sk-..."}}'

# Restart the apps to pick up new keys
kubectl rollout restart deployment -n openlit \
  -l 'app in (openai-app, anthropic-app, bedrock-app, gemini-app)'
```

### 3. Access the dashboard

```bash
kubectl port-forward svc/openlit -n openlit 3000:3000
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Default credentials: `user@openlit.io` / `openlituser`

## Manual Setup (without script)

If you prefer to apply manifests manually:

```bash
# Build sample app images
docker build -t openlit-example-openai:latest ../openai-chat-app
docker build -t openlit-example-anthropic:latest ../anthropic-chat-app
docker build -t openlit-example-bedrock:latest ../bedrock-chat-app
docker build -t openlit-example-gemini:latest ../gemini-chat-app

# Create Kind cluster
kind create cluster --name openlit-demo

# Load images into Kind
kind load docker-image openlit-example-openai:latest --name openlit-demo
kind load docker-image openlit-example-anthropic:latest --name openlit-demo
kind load docker-image openlit-example-bedrock:latest --name openlit-demo
kind load docker-image openlit-example-gemini:latest --name openlit-demo

# Apply all manifests
kubectl apply -k .
```

## Useful Commands

```bash
# Check all pods
kubectl get pods -n openlit

# Follow controller logs
kubectl logs -n openlit -l app=openlit-controller -f

# Follow a sample app's logs
kubectl logs -n openlit -l app=openai-app -f

# Check ClickHouse tables
kubectl exec -n openlit statefulset/clickhouse -- \
  clickhouse-client --user=default --password=OPENLIT \
  --database=openlit --query="SHOW TABLES"

# Port-forward ClickHouse HTTP for debugging
kubectl port-forward svc/clickhouse -n openlit 8123:8123
```

## Teardown

```bash
./teardown.sh
# or
kind delete cluster --name openlit-demo
```

## Customization

- **ClickHouse credentials**: Edit the env vars in `clickhouse.yaml`
  and the OTEL collector config in `otel-collector.yaml`
- **Controller config**: Edit the ConfigMap in `controller.yaml`
- **Storage**: The ClickHouse StatefulSet requests a 10Gi PVC by default;
  adjust in `clickhouse.yaml` under `volumeClaimTemplates`
