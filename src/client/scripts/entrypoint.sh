#!/bin/bash
set -e

# Secrets and the SQLite database live here. Create it so the container also
# starts without a mounted volume (secrets then last only as long as the
# container).
mkdir -p /app/client/data
chmod 700 /app/client/data

# Generate and persist NextAuth.js secret to ensure session persistence across restarts
NEXTAUTH_SECRET_FILE="/app/client/data/.nextauth_secret"

if [ -f "$NEXTAUTH_SECRET_FILE" ]; then
    # Load existing secret from persistent volume
    export NEXTAUTH_SECRET=$(cat "$NEXTAUTH_SECRET_FILE")
    echo "✅ Loaded existing NextAuth secret from persistent storage"
else
    # Generate new secret and save it to persistent volume
    export NEXTAUTH_SECRET=$(openssl rand -base64 32)
    echo "$NEXTAUTH_SECRET" > "$NEXTAUTH_SECRET_FILE"
    chmod 600 "$NEXTAUTH_SECRET_FILE"
    echo "✅ Generated and saved new NextAuth secret to persistent storage"
fi

# Persist a per-install cron secret so internet callers cannot trigger
# /api/*/auto and /api/agents/materialize with `X-CRON-JOB: true`.
# Local `next dev` leaves CRON_JOB_SECRET unset and still accepts "true".
CRON_JOB_SECRET_FILE="/app/client/data/.cron_job_secret"

if [ -n "${CRON_JOB_SECRET:-}" ]; then
    echo "$CRON_JOB_SECRET" > "$CRON_JOB_SECRET_FILE"
    chmod 600 "$CRON_JOB_SECRET_FILE"
    echo "✅ Using operator-provided cron job secret"
elif [ -f "$CRON_JOB_SECRET_FILE" ]; then
    export CRON_JOB_SECRET=$(cat "$CRON_JOB_SECRET_FILE")
    echo "✅ Loaded existing cron job secret from persistent storage"
else
    export CRON_JOB_SECRET=$(openssl rand -base64 32)
    echo "$CRON_JOB_SECRET" > "$CRON_JOB_SECRET_FILE"
    chmod 600 "$CRON_JOB_SECRET_FILE"
    echo "✅ Generated and saved new cron job secret to persistent storage"
fi

# Persist a per-install engine secret. The realtime engine sends it to
# /api/internal/realtime/* and the UI server sends it to the engine's own API.
# It is separate from CRON_JOB_SECRET so a leaked cron secret cannot forge
# findings, and there is no "true" fallback: both sides fail closed without it.
OPENLIT_ENGINE_SECRET_FILE="/app/client/data/.openlit_engine_secret"

if [ -n "${OPENLIT_ENGINE_SECRET:-}" ]; then
    echo "$OPENLIT_ENGINE_SECRET" > "$OPENLIT_ENGINE_SECRET_FILE"
    chmod 600 "$OPENLIT_ENGINE_SECRET_FILE"
    echo "✅ Using operator-provided engine secret"
elif [ -f "$OPENLIT_ENGINE_SECRET_FILE" ]; then
    export OPENLIT_ENGINE_SECRET=$(cat "$OPENLIT_ENGINE_SECRET_FILE")
    echo "✅ Loaded existing engine secret from persistent storage"
else
    export OPENLIT_ENGINE_SECRET=$(openssl rand -base64 32)
    echo "$OPENLIT_ENGINE_SECRET" > "$OPENLIT_ENGINE_SECRET_FILE"
    chmod 600 "$OPENLIT_ENGINE_SECRET_FILE"
    echo "✅ Generated and saved new engine secret to persistent storage"
fi
export OPENLIT_ENGINE_SECRET

# Write a shell-safe line and export it. Sourcing /etc/environment does not
# export new names, and an unquoted password containing $, spaces, or # is
# expanded or truncated. The OTLP receiver only sees variables that are
# exported in this process.
persist_warned=
persist_env() {
    local key="$1"
    local value="$2"
    export "${key}=${value}"
    if [ ! -w /etc/environment ]; then
        if [ -z "${persist_warned}" ]; then
            echo "WARNING: /etc/environment is not writable; secrets will not be persisted there." >&2
            persist_warned=1
        fi
        return 0
    fi
    sed -i "/^${key}=/d" /etc/environment
    printf '%s=%q\n' "$key" "$value" >> /etc/environment
}

persist_env NEXTAUTH_SECRET "${NEXTAUTH_SECRET}"
persist_env CRON_JOB_SECRET "${CRON_JOB_SECRET}"
persist_env OPENLIT_ENGINE_SECRET "${OPENLIT_ENGINE_SECRET}"

# Do NOT pin NEXTAUTH_URL to localhost. When it is unset, NextAuth derives the
# origin from the incoming request host (and X-Forwarded-* behind a proxy), so
# the app works on any URL (localhost, LoadBalancer, Ingress) with no config.
# Only export it when the operator explicitly set it, which is required for
# OAuth providers whose redirect URIs must match a fixed public URL.
if [ -n "${NEXTAUTH_URL}" ]; then
    persist_env NEXTAUTH_URL "${NEXTAUTH_URL}"
fi
persist_env SQLITE_DATABASE_URL "${SQLITE_DATABASE_URL:-file:../data/data.db}"
persist_env PATH "./node_modules/.bin:${PATH}"

# Environment variables for DB config
persist_env INIT_DB_USERNAME "${INIT_DB_USERNAME:-}"
persist_env INIT_DB_PASSWORD "${INIT_DB_PASSWORD:-}"
persist_env INIT_DB_HOST "${INIT_DB_HOST:-}"
persist_env INIT_DB_PORT "${INIT_DB_PORT:-}"
persist_env INIT_DB_DATABASE "${INIT_DB_DATABASE:-}"

# Re-export the file only after it was rewritten. Sourcing a read-only copy
# would replace the secrets just computed above, and a bad line must not
# stop ingest: Docker already injected the process environment.
if [ -r /etc/environment ] && [ -w /etc/environment ]; then
    set -a
    # shellcheck disable=SC1091
    . /etc/environment || echo "WARNING: could not read /etc/environment; continuing with the process environment." >&2
    set +a
fi
# Receiver reads SQLITE_DATABASE_URL / INIT_DB_* from the process environment.

# Run Prisma migrations and generate prisma client
prisma migrate deploy
prisma generate

# Run the seed 
prisma db seed

# Cron is optional. A failure here (non-root, read-only root) must not stop
# the OTLP receiver from opening :4317 and :4318.
if ! service cron start; then
    echo "WARNING: cron did not start; scheduled jobs will not run. OTLP ingest will still start." >&2
fi

# Stay PID 1 so we can reap children. 2.1.0 exec'd the UI and left a dead
# collector behind: Docker still published :4317, accepted TCP, and closed it.
# gRPC exporters then logged "End of TCP stream" while the dashboard looked healthy.
receiver_pid=
engine_pid=
node_pid=

stop_children() {
    if [ -n "${node_pid}" ]; then
        kill -TERM "${node_pid}" 2>/dev/null || true
    fi
    if [ -n "${engine_pid}" ]; then
        kill -TERM "${engine_pid}" 2>/dev/null || true
    fi
    if [ -n "${receiver_pid}" ]; then
        kill -TERM "${receiver_pid}" 2>/dev/null || true
    fi
}

on_stop() {
    echo "Stopping OpenLIT..."
    stop_children
    wait ${node_pid:+"$node_pid"} ${engine_pid:+"$engine_pid"} ${receiver_pid:+"$receiver_pid"} 2>/dev/null || true
    exit 0
}
trap on_stop TERM INT

echo "Starting OTLP receiver..."
/app/otlp-receiver/otlp-receiver &
receiver_pid=$!

# The realtime engine consumes the NATS signal stream and posts findings back
# to the UI server's internal API, authenticated with OPENLIT_ENGINE_SECRET.
# The receiver connects to NATS as NATS_RECEIVER_USER and the engine as
# NATS_ENGINE_USER (see assets/nats.conf); both are read from this environment.
if [ -n "${NATS_URL:-}" ]; then
    if [ -z "${NATS_RECEIVER_PASSWORD:-}${NATS_RECEIVER_CREDS:-}${NATS_PASSWORD:-}${NATS_CREDS:-}" ]; then
        echo "WARNING: NATS_URL is set without NATS credentials; production NATS must require auth." >&2
    fi
    echo "Starting realtime engine..."
    OPENLIT_URL="${OPENLIT_URL:-http://127.0.0.1:${DOCKER_PORT:-3000}}" \
        /app/engine/openlit-engine &
    engine_pid=$!
fi

# Starting the OpenLIT UI Server
export PORT=${DOCKER_PORT:-3000}
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
# Docker sets HOSTNAME to the container ID, which makes Next.js bind only to
# that address. Override to 0.0.0.0 so the server is reachable on all interfaces
# (localhost, container name, etc.) unless explicitly configured otherwise.
if echo "$HOSTNAME" | grep -qvE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$|^::$|^localhost$'; then
  export HOSTNAME="0.0.0.0"
fi
node --max_old_space_size=512 /app/client/server.js &
node_pid=$!

# set -e would exit on the first child failure before we can tell which one.
set +e
while true; do
    wait -n
    status=$?
    if ! kill -0 "${receiver_pid}" 2>/dev/null; then
        echo "OTLP receiver exited; stopping the container so :4317 and :4318 are not left closed." >&2
        stop_children
        wait ${node_pid:+"$node_pid"} ${engine_pid:+"$engine_pid"} 2>/dev/null
        exit 1
    fi
    if ! kill -0 "${node_pid}" 2>/dev/null; then
        stop_children
        wait ${receiver_pid:+"$receiver_pid"} ${engine_pid:+"$engine_pid"} 2>/dev/null
        exit "${status}"
    fi
    if [ -n "${engine_pid}" ] && ! kill -0 "${engine_pid}" 2>/dev/null; then
        echo "Realtime engine exited; trace ingest continues." >&2
        engine_pid=
    fi
done
