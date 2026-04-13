# OpenLIT Controller — Kubernetes Demo

Deploy the full OpenLIT stack with the Controller and sample LLM apps on any Kubernetes cluster.

The sample apps are the same ones from the repo's `examples/` folder, packaged as container images.

## What's included

| Resource                | Kind        | Description                                       |
|-------------------------|-------------|---------------------------------------------------|
| **ClickHouse**          | StatefulSet | Time-series database for telemetry                |
| **OpenLIT**             | Deployment  | Dashboard + OTLP collector                        |
| **OpenLIT Controller**  | DaemonSet   | eBPF-based LLM service discovery                  |
| **demo-openai-app**     | Deployment  | Sample app calling OpenAI (from examples/)        |
| **demo-anthropic-app**  | Deployment  | Sample app calling Anthropic (from examples/)     |
| **demo-gemini-app**     | Deployment  | Sample app calling Gemini (from examples/)        |

## Prerequisites

- A Kubernetes cluster (minikube, kind, EKS, GKE, etc.)
- `kubectl` configured and pointing to your cluster
- The cluster nodes must run Linux with kernel 5.8+ (for eBPF)

## Quick Start

```bash
# 1. Run the setup script
bash setup.sh

# 2. Forward the dashboard port to your machine
kubectl port-forward -n openlit svc/openlit 3000:3000

# 3. Open the dashboard
open http://localhost:3000
```

The Controller runs as a DaemonSet on every node and automatically discovers the sample apps making LLM API calls. Check **Instrumentation Hub** in the dashboard.

## Check status

```bash
# All pods
kubectl get pods -n openlit

# Controller logs
kubectl logs -n openlit -l app=openlit-controller -f

# Dashboard logs
kubectl logs -n openlit -l app=openlit -f
```

## Tear down

```bash
bash teardown.sh
```

This removes all resources including the namespace. No cluster-level changes remain.

## Configuration

### Use your own API keys

Edit `sample-apps.yaml` and replace `demo-key` with real keys:

```yaml
env:
  - name: OPENAI_API_KEY
    value: "sk-your-real-key"
```

Then re-apply: `kubectl apply -f sample-apps.yaml`

### Secure with an API Key

1. Open the dashboard and go to **Settings → API Keys**
2. Create an API key
3. Edit `configmap.yaml` and add:

```yaml
data:
  config.yaml: |
    openlit_url: "http://openlit.openlit.svc.cluster.local:3000"
    api_key: "your-api-key"
```

4. Re-apply: `kubectl apply -f configmap.yaml && kubectl rollout restart daemonset/openlit-controller -n openlit`

### Use Helm instead

For production deployments, use the Helm chart:

```bash
helm repo add openlit https://openlit.github.io/helm
helm install openlit openlit/openlit --set openlit-controller.enabled=true
```
