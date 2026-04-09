#!/bin/bash
set -euo pipefail

# OpenLIT Controller installer
# Usage: curl -sSL https://get.openlit.io/controller | sudo bash

REPO="openlit/openlit"
BINARY="openlit-controller"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/openlit-controller"
SERVICE_FILE="/etc/systemd/system/openlit-controller.service"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
    error "This script must be run as root (use sudo)"
fi

ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    arm64)   ARCH="arm64" ;;
    *)       error "Unsupported architecture: $ARCH" ;;
esac

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
if [ "$OS" != "linux" ]; then
    error "Unsupported OS: $OS (only Linux is supported)"
fi

info "Detecting latest release..."
LATEST=$(curl -sSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
if [ -z "$LATEST" ]; then
    warn "Could not detect latest release, using 'latest'"
    LATEST="latest"
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST}/${BINARY}-linux-${ARCH}.tar.gz"

info "Downloading ${BINARY} ${LATEST} for linux/${ARCH}..."
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

curl -sSL "$DOWNLOAD_URL" -o "$TMP_DIR/${BINARY}.tar.gz"
tar -xzf "$TMP_DIR/${BINARY}.tar.gz" -C "$TMP_DIR"

info "Installing to ${INSTALL_DIR}/${BINARY}..."
install -m 0755 "$TMP_DIR/${BINARY}-linux-${ARCH}" "${INSTALL_DIR}/${BINARY}"

info "Creating config directory..."
mkdir -p "$CONFIG_DIR"

if [ ! -f "${CONFIG_DIR}/config.yaml" ]; then
    cat > "${CONFIG_DIR}/config.yaml" <<'EOF'
# OpenLIT Controller Config
# The only required setting:
openlit_url: "http://localhost:3000"

# Optional: API key for authentication
# api_key: ""

# Optional: listen address for controller REST API
# api_listen: ":4321"
EOF
    info "Created default config at ${CONFIG_DIR}/config.yaml"
    warn "Edit ${CONFIG_DIR}/config.yaml to set your OpenLIT URL"
fi

if [ ! -f "${CONFIG_DIR}/env" ]; then
    cat > "${CONFIG_DIR}/env" <<'EOF'
# Environment overrides for openlit-controller
# OPENLIT_URL=http://localhost:3000
# OPENLIT_API_KEY=
EOF
fi

if command -v systemctl >/dev/null 2>&1; then
    info "Installing systemd service..."
    cat > "$SERVICE_FILE" <<'EOF'
[Unit]
Description=OpenLIT Controller - LLM Observability via eBPF
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/openlit-controller --config /etc/openlit-controller/config.yaml
EnvironmentFile=-/etc/openlit-controller/env
Restart=always
RestartSec=5
AmbientCapabilities=CAP_BPF CAP_SYS_PTRACE CAP_NET_RAW CAP_PERFMON CAP_DAC_READ_SEARCH CAP_CHECKPOINT_RESTORE

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable openlit-controller
    info "Service installed. Start with: sudo systemctl start openlit-controller"
else
    warn "systemd not found. Run manually: sudo ${INSTALL_DIR}/${BINARY} --config ${CONFIG_DIR}/config.yaml"
fi

info "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Edit ${CONFIG_DIR}/config.yaml and set openlit_url to your OpenLIT dashboard"
echo "  2. Start the controller: sudo systemctl start openlit-controller"
echo "  3. Check status: sudo systemctl status openlit-controller"
echo ""
