#!/bin/bash
set -e

# Generate and set NextAuth.js secret as an environment variable
export NEXTAUTH_SECRET=$(openssl rand -base64 32)

# Set NextAuth.js environment variables
echo "NEXTAUTH_SECRET=$NEXTAUTH_SECRET" >> /etc/environment
echo "PORT=${PORT:-3000}" >> /etc/environment
echo "NEXTAUTH_URL=http://localhost:$PORT" >> /etc/environment
echo "DATABASE_URL=${DATABASE_URL:-file:../.db2/data.db}" >> /etc/environment

# Run Prisma migrations and generate prisma client
npx prisma migrate deploy
npx prisma generate

# Start the Next.js application
exec npm start -- -p $PORT
