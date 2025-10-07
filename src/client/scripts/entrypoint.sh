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

# Setting Opamp Client env
echo "OPAMP_API_CLIENT=http://127.0.0.1:8080" >> /etc/environment

# Load the environment variables
source /etc/environment

# Run Prisma migrations and generate prisma client
prisma migrate deploy
prisma generate

# Run the seed 
prisma db seed

# Run crond in the background
crond &

# Generate certificates
chmod +x /app/opamp/certs/clear.sh
chmod +x /app/opamp/certs/generate.sh
cd /app/opamp/certs
./generate.sh > /var/log/certs.log
cd ../../

# Starting OpAMP Server
/app/opamp/opamp-server &

# Starting Supervisor for the OTEL Collector
/app/opamp/opampsupervisor --config=/etc/otel/supervisor.yaml &


# Starting the OpenLIT UI Server
export PORT=${DOCKER_PORT:-3000} 
# Start the Next.js application
exec node --max_old_space_size=512 client/server.js