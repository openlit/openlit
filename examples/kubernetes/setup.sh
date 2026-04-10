#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-test}"
K8S_NAMESPACE="openlit"

echo "=== OpenLIT Kubernetes Example Setup ==="
echo ""

# ── 1. Check prerequisites ──────────────────────────────────────────────
for cmd in docker k3d kubectl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' is required but not installed."
    exit 1
  fi
done

# ── 2. Create k3d cluster (1 server + 2 agents = 3 nodes) ───────────────
if k3d cluster list 2>/dev/null | grep -q "${CLUSTER_NAME}"; then
  echo "Deleting existing k3d cluster '${CLUSTER_NAME}'..."
  k3d cluster delete "${CLUSTER_NAME}"
fi

echo "Creating 3-node k3d cluster '${CLUSTER_NAME}' (1 server + 2 agents)..."
k3d cluster create "${CLUSTER_NAME}" --agents 2 --wait
kubectl cluster-info --context "k3d-${CLUSTER_NAME}"
echo ""

# ── 3. Build all images ─────────────────────────────────────────────────
echo "Building OpenLIT Dashboard image..."
docker build -t openlit:local "$REPO_ROOT/src"
echo ""

echo "Building OpenLIT Controller image..."
docker build -t openlit-controller:local "$REPO_ROOT/openlit-controller"
echo ""

echo "Building sample app images..."
docker build -t openlit-example-gemini:latest   "$REPO_ROOT/examples/gemini-chat-app"   --quiet
docker build -t openlit-example-crewai:latest   "$REPO_ROOT/examples/crewai-agent-app"  --quiet
docker build -t openlit-example-bedrock:latest  "$REPO_ROOT/examples/bedrock-chat-app"  --quiet
echo ""

echo "Loading all images into k3d cluster..."
k3d image import \
  openlit:local \
  openlit-controller:local \
  openlit-example-gemini:latest \
  openlit-example-crewai:latest \
  openlit-example-bedrock:latest \
  -c "$CLUSTER_NAME"
echo "All images loaded."
echo ""

# ── 4. Deploy infrastructure (namespace, clickhouse, otel, dashboard) ───
echo "Deploying infrastructure..."
kubectl apply -f "$SCRIPT_DIR/namespace.yaml"
kubectl apply -f "$SCRIPT_DIR/clickhouse.yaml"
kubectl apply -f "$SCRIPT_DIR/otel-collector.yaml"
kubectl apply -f "$SCRIPT_DIR/openlit.yaml"

echo "Waiting for ClickHouse..."
kubectl rollout status statefulset/clickhouse -n "$K8S_NAMESPACE" --timeout=120s
echo "Waiting for OTEL Collector..."
kubectl rollout status deployment/otel-collector -n "$K8S_NAMESPACE" --timeout=60s
echo "Waiting for OpenLIT dashboard..."
kubectl rollout status deployment/openlit -n "$K8S_NAMESPACE" --timeout=120s
echo ""

# ── 5. Deploy sample apps FIRST (before the controller) ─────────────────
echo "Deploying sample apps (before controller, to test discovery of existing LLM connections)..."
kubectl apply -f "$SCRIPT_DIR/sample-apps.yaml"

echo "Waiting for sample apps to start..."
kubectl wait --for=condition=Ready pod -l app=gemini-app -n "$K8S_NAMESPACE" --timeout=60s 2>/dev/null || true
kubectl rollout status deployment/crewai-agent-app -n "$K8S_NAMESPACE" --timeout=60s 2>/dev/null || true
kubectl rollout status daemonset/bedrock-app -n "$K8S_NAMESPACE" --timeout=60s 2>/dev/null || true

echo "Sample apps running. Letting them make LLM API calls for 15 seconds..."
sleep 15
echo ""

# ── 6. Deploy the controller (discovers already-running apps) ────────────
echo "Deploying OpenLIT Controller (should discover existing LLM traffic)..."
kubectl apply -f "$SCRIPT_DIR/controller.yaml"
kubectl rollout status daemonset/openlit-controller -n "$K8S_NAMESPACE" --timeout=120s
echo ""

# ── 7. Print access instructions ────────────────────────────────────────
echo "=== Setup Complete ==="
echo ""
echo "  Cluster: 3 nodes (1 server + 2 agents)"
echo "  Workload types:"
echo "    - gemini-app       : naked Pod"
echo "    - crewai-agent-app : Deployment (2 replicas, spread across nodes)"
echo "    - bedrock-app      : DaemonSet (runs on every node)"
echo ""
echo "  Controller was deployed AFTER apps — it should discover existing LLM connections."
echo ""
echo "To access the OpenLIT dashboard:"
echo "  kubectl port-forward svc/openlit -n ${K8S_NAMESPACE} 3000:3000"
echo "  Then open http://localhost:3000"
echo ""
echo "Node distribution:"
kubectl get pods -n "$K8S_NAMESPACE" -o wide --no-headers | awk '{printf "  %-40s %s\n", $1, $7}'
echo ""
echo "To check controller logs:"
echo "  kubectl logs -n ${K8S_NAMESPACE} -l app=openlit-controller -f"
