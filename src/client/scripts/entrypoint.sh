#!/bin/bash
set -e

# Generate and set NextAuth.js secret as an environment variable
export NEXTAUTH_SECRET=$(openssl rand -base64 32)

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

# Set OpAMP environment variables for entrypoint
export OPAMP_ENVIRONMENT=${OPAMP_ENVIRONMENT:-development}
export OPAMP_CERTS_DIR=${OPAMP_CERTS_DIR:-/app/opamp/certs}
export OPAMP_TLS_INSECURE_SKIP_VERIFY=${OPAMP_TLS_INSECURE_SKIP_VERIFY:-true}

echo "OpAMP Configuration:"
echo "  Environment: $OPAMP_ENVIRONMENT"
echo "  Certificates Directory: $OPAMP_CERTS_DIR"
echo "  TLS Insecure Skip Verify: $OPAMP_TLS_INSECURE_SKIP_VERIFY"

# Generate certificates using enhanced script
echo "Generating OpAMP certificates..."
chmod +x /app/opamp/certs/clear.sh
chmod +x /app/opamp/certs/generate.sh
cd /app/opamp/certs

# Generate certificates with proper logging
if ./generate.sh > /var/log/certs.log 2>&1; then
    echo "✅ Certificates generated successfully"
else
    echo "❌ Certificate generation failed, check /var/log/certs.log"
    cat /var/log/certs.log
fi

# Generate supervisor configuration based on environment
echo "Configuring OpAMP supervisor for $OPAMP_ENVIRONMENT environment..."
cd /app/opamp

# Create supervisor configuration dynamically
cat > /etc/otel/supervisor-dynamic.yaml << EOF
server:
  endpoint: wss://localhost:4320/v1/opamp
  tls:
EOF

if [[ "$OPAMP_ENVIRONMENT" == "production" ]]; then
    cat >> /etc/otel/supervisor-dynamic.yaml << EOF
    insecure_skip_verify: false
    ca_file: /app/opamp/certs/cert/ca.cert.pem
EOF
    echo "  Production mode: Using CA certificate verification"
else
    cat >> /etc/otel/supervisor-dynamic.yaml << EOF
    insecure_skip_verify: true
EOF
    echo "  Development mode: Skipping certificate verification"
fi

cat >> /etc/otel/supervisor-dynamic.yaml << EOF

agent:
  executable: /app/opamp/otelcontribcol
  config_files: 
    - /etc/otel/otel-collector-config.yaml

capabilities:
  accepts_remote_config: true
  reports_effective_config: true
  reports_own_metrics: false
  reports_own_logs: true
  reports_own_traces: false
  reports_health: true
  reports_remote_config: true

storage:
  directory: ./storage
EOF

echo "✅ Supervisor configuration generated"

# Starting OpAMP Server
echo "Starting OpAMP Server..."
/app/opamp/opamp-server &
OPAMP_SERVER_PID=$!

# Wait a moment for the server to start
sleep 2

# Starting Supervisor for the OTEL Collector
echo "Starting OpAMP Supervisor..."
/app/opamp/opampsupervisor --config=/etc/otel/supervisor-dynamic.yaml &
SUPERVISOR_PID=$!


# Starting the OpenLIT UI Server
export PORT=${DOCKER_PORT:-3000} 
# Start the Next.js application
exec node --max_old_space_size=512 /app/client/server.js