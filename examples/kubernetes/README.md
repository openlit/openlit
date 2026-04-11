# OpenLIT Kubernetes Example

A complete local Kubernetes setup with all OpenLIT components and sample LLM apps on a 3-node k3d cluster.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  k3d Cluster "test"  (1 server + 2 agents = 3 nodes)               │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────────┐  │
│  │  ClickHouse  │◄──│ OTEL         │◄──│  OpenLIT Controller    │  │
│  │ (StatefulSet) │   │ Collector    │   │  (DaemonSet, eBPF)     │  │
│  └──────┬───────┘   └──────────────┘   └──────────┬─────────────┘  │
│         │                                          │ discovers      │
│  ┌──────┴───────┐                    ┌─────────────┼──────────┐    │
│  │   OpenLIT    │                    │ Sample Apps  ▼          │    │
│  │  Dashboard   │                    │                         │    │
│  │  (port 3000) │                    │ gemini-app   (Pod)      │    │
│  └──────────────┘                    │ crewai-agent (Deploy/2) │    │
│                                      │ bedrock-app  (DaemonSet)│    │
│                                      └─────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Kind | Notes |
|---|---|---|
| ClickHouse | StatefulSet | `clickhouse/clickhouse-server:24.4.1` |
| OTEL Collector | Deployment | `opentelemetry-collector-contrib:0.98.0` |
| OpenLIT Dashboard | Deployment | Built locally as `openlit:local` |
| OpenLIT Controller | DaemonSet | Built locally as `openlit-controller:local` — 1 per node |
| gemini-app | naked Pod | Gemini client (tests naked Pod discovery) |
| crewai-agent-app | Deployment (2 replicas) | CrewAI agent using OpenAI (spread across nodes) |
| bedrock-app | DaemonSet | Bedrock client (runs on every node) |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [k3d](https://k3d.io/) (`brew install k3d` on macOS)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)

## Quick Start

### 1. Run the setup script

```bash
cd examples/kubernetes
./setup.sh
```

This will:
1. Delete any existing k3d cluster named `test`
2. Create a fresh 3-node k3d cluster (1 server + 2 agents)
3. Build the OpenLIT Dashboard and Controller images locally
4. Build sample app images (gemini, crewai, bedrock)
5. Load all images into the k3d cluster
6. Deploy infrastructure (ClickHouse, OTEL Collector, Dashboard)
7. Deploy sample apps and wait for them to start making LLM calls
8. Deploy the controller last (to test discovery of already-running apps)

### 2. Access the dashboard

```bash
kubectl port-forward svc/openlit -n openlit 3000:3000
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Default credentials: `user@openlit.io` / `openlituser`

### 3. Set real API keys (optional)

The sample apps are discovered by the controller even with fake keys (they just produce HTTP errors). To get real LLM traces:

```bash
kubectl patch secret llm-api-keys -n openlit -p \
  '{"stringData":{"OPENAI_API_KEY":"sk-...","GEMINI_API_KEY":"...","AWS_BEARER_BEDROCK_TOKEN":"..."}}'

# Restart apps to pick up new keys
kubectl delete pod gemini-app -n openlit
kubectl rollout restart deployment/crewai-agent-app -n openlit
kubectl rollout restart daemonset/bedrock-app -n openlit
```

## What to Test

1. **LLM Observability (eBPF)** -- The controller auto-discovers LLM API connections. Check the Instrumentation Hub to see discovered services and enable/disable instrumentation.
2. **Agent Observability (SDK injection)** -- Enable Agent Observability on any Python service. The controller injects the OpenLIT SDK via init containers and restarts the workload.
3. **Naked Pod warning** -- `gemini-app` is a naked Pod (no controller). Agent Observability should show "unsupported" since it cannot be restarted safely.
4. **Multi-node** -- The controller DaemonSet runs on all 3 nodes. Each instance discovers services on its own node.
5. **Workload types** -- Deployment, DaemonSet, and naked Pod are all represented.

## Useful Commands

```bash
# Check all pods and their node placement
kubectl get pods -n openlit -o wide

# Follow controller logs (all nodes)
kubectl logs -n openlit -l app=openlit-controller -f

# Follow a specific controller instance
kubectl logs -n openlit -l app=openlit-controller --field-selector spec.nodeName=k3d-test-agent-0 -f

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
# or directly:
k3d cluster delete test
```
