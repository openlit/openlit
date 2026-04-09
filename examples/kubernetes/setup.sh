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

# ── 2. Verify k3d cluster exists ────────────────────────────────────────
if ! k3d cluster list 2>/dev/null | grep -q "${CLUSTER_NAME}"; then
  echo "ERROR: k3d cluster '${CLUSTER_NAME}' not found. Create it first:"
  echo "  k3d cluster create ${CLUSTER_NAME}"
  exit 1
fi

echo "Using existing k3d cluster '${CLUSTER_NAME}'"
kubectl cluster-info --context "k3d-${CLUSTER_NAME}"
echo ""

# ── 3. Build and load the OpenLIT Dashboard image ───────────────────────
echo "Building OpenLIT Dashboard image (from local source)..."
docker build -t openlit:local "$REPO_ROOT/src"
k3d image import openlit:local -c "$CLUSTER_NAME"
echo "Dashboard image loaded into k3d cluster."
echo ""

# ── 4. Build and load the OpenLIT Controller image ──────────────────────
echo "Building OpenLIT Controller image..."
docker build -t openlit-controller:local "$REPO_ROOT/openlit-controller"
k3d image import openlit-controller:local -c "$CLUSTER_NAME"
echo "Controller image loaded into k3d cluster."
echo ""

# ── 5. Build and load sample app images into k3d ────────────────────────
echo "Building sample app images..."

IMAGES="openlit-example-openai openlit-example-anthropic openlit-example-bedrock openlit-example-gemini"
DIRS="openai-chat-app anthropic-chat-app bedrock-chat-app gemini-chat-app"

set -- $DIRS
for img in $IMAGES; do
  dir="$REPO_ROOT/examples/$1"; shift
  echo "  Building ${img} from ${dir}..."
  docker build -t "${img}:latest" "$dir" --quiet
  k3d image import "${img}:latest" -c "$CLUSTER_NAME"
done

echo "All images loaded into k3d cluster."
echo ""

# ── 6. Deploy everything with Kustomize ─────────────────────────────────
echo "Applying Kubernetes manifests..."
kubectl apply -k "$SCRIPT_DIR"
echo ""

# ── 7. Wait for ClickHouse to be ready ──────────────────────────────────
echo "Waiting for ClickHouse to be ready..."
kubectl rollout status statefulset/clickhouse -n "$K8S_NAMESPACE" --timeout=120s

echo "Waiting for OTEL Collector..."
kubectl rollout status deployment/otel-collector -n "$K8S_NAMESPACE" --timeout=60s

echo "Waiting for OpenLIT dashboard..."
kubectl rollout status deployment/openlit -n "$K8S_NAMESPACE" --timeout=120s

echo ""

# ── 8. Print access instructions ────────────────────────────────────────
echo "=== Setup Complete ==="
echo ""
echo "All components are running in the '${K8S_NAMESPACE}' namespace."
echo ""
echo "To access the OpenLIT dashboard:"
echo "  kubectl port-forward svc/openlit -n ${K8S_NAMESPACE} 3000:3000"
echo "  Then open http://localhost:3000"
echo ""
echo "To set your API keys (edit the secret, then restart apps):"
echo "  kubectl edit secret llm-api-keys -n ${K8S_NAMESPACE}"
echo "  kubectl rollout restart deployment -n ${K8S_NAMESPACE} -l 'app in (openai-app, anthropic-app, bedrock-app, gemini-app)'"
echo ""
echo "To check controller logs:"
echo "  kubectl logs -n ${K8S_NAMESPACE} -l app=openlit-controller -f"
echo ""
echo "To check sample app logs:"
echo "  kubectl logs -n ${K8S_NAMESPACE} -l app=openai-app -f"
echo ""
echo "To tear down (resources only, keeps cluster):"
echo "  kubectl delete -k $SCRIPT_DIR"
echo ""
echo "To tear down (entire cluster):"
echo "  k3d cluster delete ${CLUSTER_NAME}"
