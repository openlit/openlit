#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
step()  { echo -e "\n${YELLOW}→${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

step "Creating namespace"
kubectl apply -f "$SCRIPT_DIR/namespace.yaml"

step "Deploying ClickHouse + OpenLIT dashboard"
kubectl apply -f "$SCRIPT_DIR/openlit.yaml"

step "Waiting for OpenLIT to be ready (this may take 1-2 minutes)..."
kubectl rollout status deployment/openlit -n openlit --timeout=120s 2>/dev/null || true
sleep 10

step "Setting up RBAC for the controller"
kubectl apply -f "$SCRIPT_DIR/serviceaccount.yaml"
kubectl apply -f "$SCRIPT_DIR/clusterrole.yaml"
kubectl apply -f "$SCRIPT_DIR/clusterrolebinding.yaml"

step "Deploying controller config"
kubectl apply -f "$SCRIPT_DIR/configmap.yaml"

step "Deploying the OpenLIT Controller (DaemonSet)"
kubectl apply -f "$SCRIPT_DIR/daemonset.yaml"

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
