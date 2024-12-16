#!/bin/bash
set -e

# Generate and set NextAuth.js secret as an environment variable
export NEXTAUTH_SECRET=$(openssl rand -base64 32)

# Set NextAuth.js environment variables
# Default Telemetry enabled, Set this to false to disable telemetry tracking
echo "TELEMETRY_ENABLED=true" >> /etc/environment

# POSTHOG Key
echo "POSTHOG_API_KEY=phc_JiR0FxzxAYeV3gDoMUltOxjLa3r7RnogMHPVrjDzTR9" >> /etc/environment
echo "POSTHOG_HOST=https://us.i.posthog.com" >> /etc/environment

echo "NEXTAUTH_SECRET=$NEXTAUTH_SECRET" >> /etc/environment
echo "NEXTAUTH_URL=http://localhost:3000" >> /etc/environment
echo "SQLITE_DATABASE_URL=${SQLITE_DATABASE_URL:-file:../data/data.db}" >> /etc/environment

# Environment variables for DB config
echo "INIT_DB_USERNAME=${INIT_DB_USERNAME}" >> /etc/environment
echo "INIT_DB_PASSWORD=${INIT_DB_PASSWORD}" >> /etc/environment
echo "INIT_DB_HOST=${INIT_DB_HOST}" >> /etc/environment
echo "INIT_DB_PORT=${INIT_DB_PORT}" >> /etc/environment
echo "INIT_DB_DATABASE=${INIT_DB_DATABASE}" >> /etc/environment

# Load the environment variables
source /etc/environment

# Run Prisma migrations and generate prisma client
npm install -g prisma
prisma migrate deploy
prisma generate

# Run the seed 
prisma db seed

# Start the Next.js application
exec node --max_old_space_size=512 $(which npm) start
