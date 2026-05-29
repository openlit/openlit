# Node.js builder - pinned to alpine 3.21 with digest
FROM alpine:3.21@sha256:c3f8e73fdb79deaebaa2037150150191b9dcbfba68b4a46d70103204c53f4709 AS builder

# Installing node and npm
RUN apk add --no-cache nodejs npm

# Installing extra packages (openssl needed for Prisma engine detection on Alpine 3.21+)
RUN apk add --no-cache rust cargo build-base openssl

# Set the working directory in the container
WORKDIR /app/client

# Copy package.json and package-lock.json to the working directory & the rest of the application code
COPY ./client/ .

# Install dependencies, generate Prisma client & Build the Next.js application
RUN npm install && npx prisma generate && npm run build


# Opamp server build from source - pinned with digest
FROM golang:1.25-alpine@sha256:8e02eb337d9e0ea459e041f1ee5eece41cbb61f1d83e7d883a3e2fb4862063fa AS go-builder

# Set working directory for opamp-server
WORKDIR /app/opamp-server

# Copy the rest of the opamp-server source code
COPY ./opamp-server/ ./

# Build the opamp-server binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o opamp-server .


# OpenTelemetry Collector Contrib download - pinned with digest
FROM alpine:3.21@sha256:c3f8e73fdb79deaebaa2037150150191b9dcbfba68b4a46d70103204c53f4709 AS otel-downloader

# Accept build arguments (TARGETARCH is automatically provided by Docker buildx)
# Default to amd64 if not specified (most common architecture)
ARG OTEL_VERSION=v0.142.0
ARG OPAMP_SUPERVISOR_VERSION=v0.142.0
ARG TARGETARCH=amd64
ARG TARGETPLATFORM

# Install curl and file utilities for downloading binaries and verification
RUN apk add --no-cache curl file

# Set working directory
WORKDIR /tmp

# Download OpenTelemetry Collector Contrib and OpAMP Supervisor
RUN echo "Downloading binaries for architecture: ${TARGETARCH}" && \
    curl -LO "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/${OTEL_VERSION}/otelcol-contrib_${OTEL_VERSION#v}_linux_${TARGETARCH}.tar.gz" && \
    tar -xzf "otelcol-contrib_${OTEL_VERSION#v}_linux_${TARGETARCH}.tar.gz" && \
    chmod +x otelcol-contrib && \
    echo "otelcol-contrib binary info:" && file otelcol-contrib && \
    curl --proto '=https' --tlsv1.2 -fL -o opampsupervisor \
    "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/cmd%2Fopampsupervisor%2F${OPAMP_SUPERVISOR_VERSION}/opampsupervisor_${OPAMP_SUPERVISOR_VERSION#v}_linux_${TARGETARCH}" && \
    chmod +x opampsupervisor && \
    echo "opampsupervisor binary info:" && file opampsupervisor


# Final runtime image - Use node:18-bullseye-slim pinned with digest
# This replaces the unsafe `curl | bash` NodeSource install pattern
FROM node:18-bullseye-slim@sha256:d69fb189fa7765636655db043a6a9e6be5ddf94bd1a8dc33fd0bcf4664606a9e

# Accept build arguments to pass version and architecture info
# TARGETARCH is automatically provided by Docker buildx based on --platform
# Default to amd64 if not specified (must match otel-downloader stage)
ARG OPAMP_SUPERVISOR_VERSION=v0.142.0
ARG TARGETARCH=amd64
ARG TARGETPLATFORM


# Set as environment variables for use by scripts
ENV OPAMP_SUPERVISOR_VERSION=${OPAMP_SUPERVISOR_VERSION}
ENV TARGETARCH=${TARGETARCH}

# Install only the additional runtime dependencies needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    openssl \
    ca-certificates \
    cron \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app/client

# Copy only necessary files from the builder stages

# Copying the standalone next.js build
COPY --from=builder /app/client/.next/standalone ./
# Standalone build doesn't copy public, static, prisma, scripts
COPY --from=builder /app/client/public ./public
COPY --from=builder /app/client/.next/static ./.next/static
COPY --from=builder /app/client/prisma ./prisma
COPY --from=builder /app/client/scripts ./scripts
# Copying prisma client, prisma and prisma cli (.bin) from builder stage
COPY --from=builder /app/client/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/client/node_modules/.bin ./node_modules/.bin
COPY --from=builder /app/client/node_modules/prisma ./node_modules/prisma

# Copy the built opamp-server binary from go-builder stage
COPY --from=go-builder /app/opamp-server/opamp-server /app/opamp/opamp-server
COPY --from=go-builder /app/opamp-server/certs /app/opamp/certs
COPY --from=go-builder /app/opamp-server/setup-supervisor.sh /app/opamp/setup-supervisor.sh

# Copy OpenTelemetry Collector and OpAMP Supervisor binaries
# Place otelcol-contrib at the path expected by supervisor configuration file
COPY --from=otel-downloader /tmp/otelcol-contrib /app/opamp/otelcontribcol
COPY --from=otel-downloader /tmp/opampsupervisor /app/opamp/opampsupervisor

# Verify binary architectures match runtime
RUN apt-get update && apt-get install -y --no-install-recommends file && \
    echo "Verifying binary architectures..." && \
    echo "Runtime architecture: $(uname -m)" && \
    echo "otelcontribcol:" && file /app/opamp/otelcontribcol && \
    echo "opampsupervisor:" && file /app/opamp/opampsupervisor && \
    rm -rf /var/lib/apt/lists/*

# Execute entrypoint script to generate NextAuth.js secret and run commands
RUN chmod +x ./scripts/entrypoint.sh /app/opamp/otelcontribcol /app/opamp/opampsupervisor /app/opamp/opamp-server /app/opamp/setup-supervisor.sh
RUN chmod -R u=rwX,go= /app/opamp/certs

# Expose the port that Next.js will run on
EXPOSE ${DOCKER_PORT:-3000}

# Run the entrypoint script
CMD ["/app/client/scripts/entrypoint.sh"]
