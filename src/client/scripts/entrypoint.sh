#!/bin/bash
set -e

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

# Set NextAuth.js environment variables
# remove any existing NEXTAUTH_SECRET line, then append the current value
if [ -w /etc/environment ]; then
    sed -i '/^NEXTAUTH_SECRET=/d' /etc/environment
    echo "NEXTAUTH_SECRET=$NEXTAUTH_SECRET" >> /etc/environment
    sed -i '/^CRON_JOB_SECRET=/d' /etc/environment
    echo "CRON_JOB_SECRET=$CRON_JOB_SECRET" >> /etc/environment
else
    echo "WARNING: /etc/environment is not writable; NEXTAUTH_SECRET and CRON_JOB_SECRET will not be persisted there." >&2
fi

# Do NOT pin NEXTAUTH_URL to localhost. When it is unset, NextAuth derives the
# origin from the incoming request host (and X-Forwarded-* behind a proxy), so
# the app works on any URL (localhost, LoadBalancer, Ingress) with no config.
# Only export it when the operator explicitly set it, which is required for
# OAuth providers whose redirect URIs must match a fixed public URL.
if [ -n "${NEXTAUTH_URL}" ]; then
    echo "NEXTAUTH_URL=${NEXTAUTH_URL}" >> /etc/environment
fi
echo "SQLITE_DATABASE_URL=${SQLITE_DATABASE_URL:-file:../data/data.db}" >> /etc/environment
echo "PATH=./node_modules/.bin:$PATH" >> /etc/environment

# Environment variables for DB config
echo "INIT_DB_USERNAME=${INIT_DB_USERNAME}" >> /etc/environment
echo "INIT_DB_PASSWORD=${INIT_DB_PASSWORD}" >> /etc/environment
echo "INIT_DB_HOST=${INIT_DB_HOST}" >> /etc/environment
echo "INIT_DB_PORT=${INIT_DB_PORT}" >> /etc/environment
echo "INIT_DB_DATABASE=${INIT_DB_DATABASE}" >> /etc/environment

# Load the environment variables
. /etc/environment
# Receiver reads SQLITE_DATABASE_URL / INIT_DB_* from the process environment.

# Run Prisma migrations and generate prisma client
prisma migrate deploy
prisma generate

# Run the seed 
prisma db seed

# Run crond in the background
service cron start

echo "Starting OTLP receiver..."
/app/otlp-receiver/otlp-receiver &

# Starting the OpenLIT UI Server
export PORT=${DOCKER_PORT:-3000}
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
# Docker sets HOSTNAME to the container ID, which makes Next.js bind only to
# that address. Override to 0.0.0.0 so the server is reachable on all interfaces
# (localhost, container name, etc.) unless explicitly configured otherwise.
if echo "$HOSTNAME" | grep -qvE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$|^::$|^localhost$'; then
  export HOSTNAME="0.0.0.0"
fi
exec node --max_old_space_size=512 /app/client/server.js