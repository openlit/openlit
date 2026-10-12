#!/usr/bin/env bash
# Run the OpenLIT UI (next dev), OTLP receiver, realtime engine and a NATS
# JetStream server together for local development. Ctrl+C stops everything.
#
# Usage: scripts/dev-realtime.sh
#
# Overrides (all optional):
#   UI_PORT              Next.js port (default: port of NEXTAUTH_URL in src/client/.env, else 3000)
#   OTLP_HTTP_PORT       Receiver OTLP/HTTP port (default 4318, falls back to 14318 if busy)
#   OTLP_GRPC_PORT       Receiver OTLP/gRPC port (default 4317, falls back to 14317 if busy)
#   NATS_PORT            NATS client port (default 4222)
#   NATS_MONITOR_PORT    NATS monitoring port (default 8222)
#   ENGINE_HTTP_ADDR     Engine health/stats address (default 127.0.0.1:4330)
#   SQLITE_DATABASE_URL  Defaults to the value in src/client/.env
#   INIT_DB_HOST/PORT/USERNAME/PASSWORD/DATABASE  ClickHouse (default 127.0.0.1:8123 default/OPENLIT openlit)
#   NATS_USE_DOCKER=1    Run NATS in docker even when a local nats-server binary exists
#   KEEP_NATS=1          Leave the NATS container running on exit
#   SKIP_MIGRATE=1       Skip `prisma migrate deploy`
#   SEED=1               Run `prisma db seed` (default user, org, project, DB config) after migrating
#   OPENLIT_REALTIME_*   Built-in trigger thresholds, passed through to the UI server
#   OPENLIT_SIGNAL_ATTRIBUTES  Extra span attributes rules may match (comma-separated)
#   NATS_RECEIVER_PASSWORD / NATS_ENGINE_PASSWORD  NATS user passwords (random per session)
#   OPENLIT_ENGINE_SECRET      Engine <-> UI secret (random per session)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$ROOT/src/client"
RECEIVER_DIR="$ROOT/src/otlp-receiver"
ENGINE_DIR="$ROOT/src/engine"
NATS_CONTAINER="${NATS_CONTAINER:-openlit-dev-nats}"
NATS_IMAGE="${NATS_IMAGE:-nats:2.10-alpine}"

log() { printf '\033[1;36m[dev]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[dev]\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed"; }
need docker
need go
need npm
need curl

dotenv_value() {
	local file="$CLIENT_DIR/.env"
	[ -f "$file" ] || return 0
	grep -E "^[[:space:]]*$1=" "$file" | tail -n 1 | sed -E "s/^[[:space:]]*$1=//; s/^[\"']//; s/[\"']$//"
}

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

pick_port() {
	local name="$1" preferred="$2" fallback="$3" explicit="$4"
	if port_busy "$preferred"; then
		[ -n "$explicit" ] && die "$name port $preferred is already in use"
		port_busy "$fallback" && die "$name ports $preferred and $fallback are both in use; set ${name}_PORT"
		log "$name port $preferred is busy, using $fallback" >&2
		echo "$fallback"
	else
		echo "$preferred"
	fi
}

wait_for() {
	local what="$1" url="$2" tries="${3:-60}"
	for _ in $(seq 1 "$tries"); do
		curl -fsS -o /dev/null "$url" 2>/dev/null && return 0
		sleep 1
	done
	die "timed out waiting for $what ($url)"
}

# ---- configuration ---------------------------------------------------------

export SQLITE_DATABASE_URL="${SQLITE_DATABASE_URL:-$(dotenv_value SQLITE_DATABASE_URL)}"
[ -n "$SQLITE_DATABASE_URL" ] || die "SQLITE_DATABASE_URL is not set (env or src/client/.env)"

if [ -z "${UI_PORT:-}" ]; then
	nextauth_url="$(dotenv_value NEXTAUTH_URL)"
	UI_PORT="$(printf '%s' "$nextauth_url" | sed -nE 's#^https?://[^/:]+:([0-9]+).*#\1#p')"
	UI_PORT="${UI_PORT:-3000}"
fi
port_busy "$UI_PORT" && die "UI port $UI_PORT is already in use; set UI_PORT"

OTLP_HTTP_PORT="$(pick_port OTLP_HTTP "${OTLP_HTTP_PORT:-4318}" 14318 "${OTLP_HTTP_PORT:-}")"
OTLP_GRPC_PORT="$(pick_port OTLP_GRPC "${OTLP_GRPC_PORT:-4317}" 14317 "${OTLP_GRPC_PORT:-}")"
NATS_PORT="${NATS_PORT:-4222}"
NATS_MONITOR_PORT="${NATS_MONITOR_PORT:-8222}"
ENGINE_HTTP_ADDR="${ENGINE_HTTP_ADDR:-127.0.0.1:4330}"

export INIT_DB_HOST="${INIT_DB_HOST:-127.0.0.1}"
export INIT_DB_PORT="${INIT_DB_PORT:-8123}"
export INIT_DB_USERNAME="${INIT_DB_USERNAME:-default}"
export INIT_DB_PASSWORD="${INIT_DB_PASSWORD:-OPENLIT}"
export INIT_DB_DATABASE="${INIT_DB_DATABASE:-openlit}"

# Per-session secrets. The engine secret is shared by the UI server and the
# engine; the cron secret keeps cron routes off the "true" fallback.
export CRON_JOB_SECRET="${CRON_JOB_SECRET:-$(openssl rand -hex 24)}"
export OPENLIT_ENGINE_SECRET="${OPENLIT_ENGINE_SECRET:-$(openssl rand -hex 24)}"
export NATS_URL="nats://127.0.0.1:${NATS_PORT}"
# NATS runs with assets/nats.conf, so dev exercises the production permissions.
NATS_CONF="$ROOT/assets/nats.conf"
export NATS_RECEIVER_PASSWORD="${NATS_RECEIVER_PASSWORD:-$(openssl rand -hex 16)}"
export NATS_ENGINE_PASSWORD="${NATS_ENGINE_PASSWORD:-$(openssl rand -hex 16)}"

# ---- process supervision ---------------------------------------------------

PIDS=()
STARTED_NATS=0

cleanup() {
	trap - INT TERM EXIT
	log "stopping..."
	for pid in "${PIDS[@]:-}"; do
		[ -n "$pid" ] && kill -TERM -- "-$pid" 2>/dev/null || true
	done
	sleep 1
	for pid in "${PIDS[@]:-}"; do
		[ -n "$pid" ] && kill -KILL -- "-$pid" 2>/dev/null || true
	done
	if [ "$STARTED_NATS" = 1 ] && [ "${KEEP_NATS:-0}" != 1 ]; then
		docker rm -f "$NATS_CONTAINER" >/dev/null 2>&1 || true
	fi
}
trap cleanup INT TERM EXIT

# Each service runs in its own process group so `go run` children and the
# Next.js worker tree are torn down together.
set -m
run() {
	local name="$1" color="$2" dir="$3"
	shift 3
	(
		cd "$dir"
		exec "$@" 2>&1 | awk -v p="$(printf '\033[%sm[%s]\033[0m ' "$color" "$name")" '{ print p $0; fflush() }'
	) &
	PIDS+=("$!")
}

# ---- dependencies ----------------------------------------------------------

if ! curl -fsS -o /dev/null "http://${INIT_DB_HOST}:${INIT_DB_PORT}/ping" 2>/dev/null; then
	log "ClickHouse not reachable on ${INIT_DB_HOST}:${INIT_DB_PORT}, starting it with docker compose"
	OPENLIT_DB_USER="$INIT_DB_USERNAME" OPENLIT_DB_PASSWORD="$INIT_DB_PASSWORD" OPENLIT_DB_NAME="$INIT_DB_DATABASE" \
		docker compose -f "$ROOT/src/dev-docker-compose.yml" up -d clickhouse
	wait_for ClickHouse "http://${INIT_DB_HOST}:${INIT_DB_PORT}/ping" 180
fi
log "ClickHouse ready on ${INIT_DB_HOST}:${INIT_DB_PORT}"

NATS_BIN="$(command -v nats-server 2>/dev/null || true)"
[ -z "$NATS_BIN" ] && [ -x "$(go env GOPATH)/bin/nats-server" ] && NATS_BIN="$(go env GOPATH)/bin/nats-server"

if [ -n "$NATS_BIN" ] && [ "${NATS_USE_DOCKER:-0}" != 1 ]; then
	port_busy "$NATS_PORT" && die "NATS port $NATS_PORT is already in use; set NATS_PORT"
	NATS_STORE="${NATS_STORE:-${TMPDIR:-/tmp}/openlit-dev-nats}"
	mkdir -p "$NATS_STORE"
	log "starting $NATS_BIN (store: $NATS_STORE)"
	run nats 34 "$ROOT" "$NATS_BIN" -c "$NATS_CONF" -sd "$NATS_STORE" \
		-a 127.0.0.1 -p "$NATS_PORT" -m "$NATS_MONITOR_PORT"
	wait_for "NATS JetStream" "http://127.0.0.1:${NATS_MONITOR_PORT}/healthz?js-enabled-only=true"
else
	docker rm -f "$NATS_CONTAINER" >/dev/null 2>&1 || true
	port_busy "$NATS_PORT" && die "NATS port $NATS_PORT is already in use; set NATS_PORT"
	log "starting NATS in docker ($NATS_IMAGE); install nats-server locally to skip docker:"
	log "  go install github.com/nats-io/nats-server/v2@v2.12.15"
	# Monitoring stays on loopback inside the container (see nats.conf).
	docker run -d --name "$NATS_CONTAINER" \
		-e NATS_RECEIVER_PASSWORD -e NATS_ENGINE_PASSWORD \
		-v "$NATS_CONF:/etc/nats/nats.conf:ro" \
		-p "127.0.0.1:${NATS_PORT}:4222" \
		"$NATS_IMAGE" -c /etc/nats/nats.conf >/dev/null
	STARTED_NATS=1
	for _ in $(seq 1 60); do
		docker exec "$NATS_CONTAINER" wget -qO- "http://127.0.0.1:8222/healthz?js-enabled-only=true" >/dev/null 2>&1 && break
		sleep 1
	done
	docker exec "$NATS_CONTAINER" wget -qO- "http://127.0.0.1:8222/healthz?js-enabled-only=true" >/dev/null 2>&1 ||
		die "timed out waiting for NATS JetStream (docker logs $NATS_CONTAINER)"
fi
log "NATS ready on $NATS_URL"

if [ "${SKIP_MIGRATE:-0}" != 1 ]; then
	log "applying Prisma migrations"
	(cd "$CLIENT_DIR" && npx prisma migrate deploy >/dev/null) || die "prisma migrate deploy failed for $SQLITE_DATABASE_URL.
      Resolve it (https://pris.ly/d/migrate-resolve), point SQLITE_DATABASE_URL at another file, or rerun with SKIP_MIGRATE=1."
	(cd "$CLIENT_DIR" && npx prisma generate >/dev/null)
	if [ -n "${SEED:-}" ]; then
		(cd "$CLIENT_DIR" && npx prisma db seed >/dev/null) || die "prisma db seed failed"
	fi
fi

# ---- services --------------------------------------------------------------

run ui 35 "$CLIENT_DIR" env \
	PORT="$UI_PORT" \
	OPENLIT_ENGINE_URL="http://${ENGINE_HTTP_ADDR}" \
	npm run dev -- --port "$UI_PORT"

run receiver 33 "$RECEIVER_DIR" env \
	OTLP_HTTP_ADDR="127.0.0.1:${OTLP_HTTP_PORT}" \
	OTLP_GRPC_ADDR="127.0.0.1:${OTLP_GRPC_PORT}" \
	OTLP_STATS_ADDR="${OTLP_STATS_ADDR:-127.0.0.1:4319}" \
	NATS_RECEIVER_USER=openlit-receiver \
	go run ./cmd/otlp-receiver

run engine 32 "$ENGINE_DIR" env \
	OPENLIT_URL="http://127.0.0.1:${UI_PORT}" \
	ENGINE_HTTP_ADDR="$ENGINE_HTTP_ADDR" \
	NATS_ENGINE_USER=openlit-engine \
	go run ./cmd/openlit-engine

log "UI:            http://localhost:${UI_PORT}"
log "OTLP HTTP:     http://127.0.0.1:${OTLP_HTTP_PORT}"
log "OTLP gRPC:     127.0.0.1:${OTLP_GRPC_PORT}"
log "OTLP stats:    http://${OTLP_STATS_ADDR:-127.0.0.1:4319}/stats"
log "Engine stats:  curl -H \"X-OpenLIT-Engine-Secret: \$OPENLIT_ENGINE_SECRET\" http://${ENGINE_HTTP_ADDR}/stats"
log "press Ctrl+C to stop"

# bash 3.2 (macOS) has no `wait -n`; poll so one crashed service stops all.
while :; do
	for pid in "${PIDS[@]}"; do
		if ! kill -0 "$pid" 2>/dev/null; then
			log "a service exited (pid $pid); shutting down"
			exit 1
		fi
	done
	sleep 1
done
