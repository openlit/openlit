#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
info() { echo -e "${GREEN}[✓]${NC} $*"; }
step() { echo -e "\n${RED}→${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

step "Removing sample apps"
kubectl delete -f "$SCRIPT_DIR/sample-apps.yaml" --ignore-not-found

step "Removing controller"
kubectl delete -f "$SCRIPT_DIR/daemonset.yaml" --ignore-not-found
kubectl delete -f "$SCRIPT_DIR/configmap.yaml" --ignore-not-found

step "Removing RBAC"
kubectl delete -f "$SCRIPT_DIR/clusterrolebinding.yaml" --ignore-not-found
kubectl delete -f "$SCRIPT_DIR/clusterrole.yaml" --ignore-not-found
kubectl delete -f "$SCRIPT_DIR/serviceaccount.yaml" --ignore-not-found

step "Removing OpenLIT + ClickHouse"
kubectl delete -f "$SCRIPT_DIR/openlit.yaml" --ignore-not-found

step "Removing namespace"
kubectl delete -f "$SCRIPT_DIR/namespace.yaml" --ignore-not-found

info "Teardown complete. All resources removed."
