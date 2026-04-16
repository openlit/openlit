#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
step()  { echo -e "\n${YELLOW}→${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

for cmd in docker kubectl; do
  if ! command -v "$cmd" &>/dev/null; then
    error "'$cmd' is required but not installed."
  fi
done

# --- Step 1: Build images from source ---
step "Building images from source"

echo "  Building OpenLIT Dashboard..."
docker build -t openlit:local "$REPO_ROOT/src"

echo "  Building OpenLIT Controller..."
docker build -t openlit-controller:local "$REPO_ROOT/openlit-controller"

echo "  Building sample apps..."
docker build -t demo-openai-app:local      "$REPO_ROOT/examples/openai-chat-app"    --quiet
docker build -t demo-anthropic-app:local    "$REPO_ROOT/examples/anthropic-chat-app" --quiet
docker build -t demo-gemini-app:local       "$REPO_ROOT/examples/gemini-chat-app"    --quiet
docker build -t demo-crewai-app:local       "$REPO_ROOT/examples/crewai-agent-app"   --quiet
info "All images built"

# --- Step 2: Load images into cluster (auto-detect environment) ---
step "Loading images into cluster"

load_images() {
  local images="openlit:local openlit-controller:local demo-openai-app:local demo-anthropic-app:local demo-gemini-app:local demo-crewai-app:local"

  if command -v k3d &>/dev/null; then
    local cluster="${K3D_CLUSTER:-$(k3d cluster list -o json 2>/dev/null | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)}"
    if [ -n "$cluster" ]; then
      echo "  Detected k3d cluster: $cluster"
      k3d image import $images -c "$cluster"
      return 0
    fi
  fi

  if command -v kind &>/dev/null; then
    local cluster="${KIND_CLUSTER:-$(kind get clusters 2>/dev/null | head -1)}"
    if [ -n "$cluster" ]; then
      echo "  Detected kind cluster: $cluster"
      for img in $images; do
        kind load docker-image "$img" --name "$cluster"
      done
      return 0
    fi
  fi

  if command -v minikube &>/dev/null && minikube status &>/dev/null; then
    echo "  Detected minikube"
    for img in $images; do
      minikube image load "$img"
    done
    return 0
  fi

  echo "  No local cluster tool (k3d/kind/minikube) detected."
  echo "  Images are built locally. Push them to your registry or load them manually."
  return 0
}

load_images
info "Images ready"

# --- Step 3: Deploy infrastructure ---
step "Creating namespace"
kubectl apply -f "$SCRIPT_DIR/namespace.yaml"

step "Deploying ClickHouse + OpenLIT dashboard"
kubectl apply -f "$SCRIPT_DIR/openlit.yaml"

step "Waiting for OpenLIT to be ready (this may take 1-2 minutes)..."
kubectl rollout status deployment/openlit -n openlit --timeout=120s 2>/dev/null || true
sleep 10

# --- Step 4: Deploy controller ---
step "Setting up RBAC for the controller"
kubectl apply -f "$SCRIPT_DIR/serviceaccount.yaml"
kubectl apply -f "$SCRIPT_DIR/clusterrole.yaml"
kubectl apply -f "$SCRIPT_DIR/clusterrolebinding.yaml"

step "Deploying controller config"
kubectl apply -f "$SCRIPT_DIR/configmap.yaml"

step "Deploying the OpenLIT Controller (DaemonSet)"
kubectl apply -f "$SCRIPT_DIR/daemonset.yaml"

# --- Step 5: Deploy sample apps ---
step "Deploying sample LLM apps"
kubectl apply -f "$SCRIPT_DIR/sample-apps.yaml"

step "Waiting for pods..."
sleep 5
kubectl get pods -n openlit

info "Setup complete!"
echo ""
echo "  Dashboard:  kubectl port-forward -n openlit svc/openlit 3000:3000"
echo "              then open http://localhost:3000"
echo ""
echo "  Logs:       kubectl logs -n openlit -l app=openlit-controller -f"
echo ""
echo "  Tear down:  bash $(basename "$SCRIPT_DIR")/teardown.sh"
echo ""
