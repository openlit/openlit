#!/bin/bash
set -e

# Generate and set NextAuth.js secret as an environment variable
export NEXTAUTH_SECRET=$(openssl rand -base64 32)
# OPAMP
export OPAMP_PORT=${OPENLIT_OPAMP_PORT:-4320}
export OPAMP_SERVER_URL="http://127.0.0.1:${OPAMP_PORT}"

# Simulate Docker Service DNS
echo "127.0.0.1      ch-server" >> /etc/hosts
echo "127.0.0.1      db" >> /etc/hosts

echo ""
echo "Send OpenTelemetry data via:
  http/protobuf: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
  gRPC: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
"

# Start Otel Collector directly
/otelcontribcol --config /etc/otel/config.yaml > /var/log/otel-collector.log 2>&1 &


# Set NextAuth.js environment variables
echo "NEXTAUTH_SECRET=$NEXTAUTH_SECRET" >> /etc/environment
echo "NEXTAUTH_URL=http://localhost:${DOCKER_PORT:-3000}" >> /etc/environment
echo "SQLITE_DATABASE_URL=${SQLITE_DATABASE_URL:-file:../data/data.db}" >> /etc/environment
echo "PATH=./node_modules/.bin:$PATH" >> /etc/environment

# Environment variables for DB config
echo "INIT_DB_USERNAME=${INIT_DB_USERNAME}" >> /etc/environment
echo "INIT_DB_PASSWORD=${INIT_DB_PASSWORD}" >> /etc/environment
echo "INIT_DB_HOST=${INIT_DB_HOST}" >> /etc/environment
echo "INIT_DB_PORT=${INIT_DB_PORT}" >> /etc/environment
echo "INIT_DB_DATABASE=${INIT_DB_DATABASE}" >> /etc/environment

# Load the environment variables
source /etc/environment

# Run Prisma migrations and generate prisma client
prisma migrate deploy
prisma generate

# Run the seed 
prisma db seed

# Run crond in the background
crond &

export PORT=${DOCKER_PORT:-3000} 
# Start the Next.js application
exec node --max_old_space_size=512 server.js
