# Node.js builder - Node 20 Alpine (OpenPlait adapters require >=20)
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

# Installing extra packages (openssl needed for Prisma engine detection on Alpine)
RUN apk add --no-cache rust cargo build-base openssl

# Set the working directory in the container
WORKDIR /app/client

# Copy package.json and package-lock.json to the working directory & the rest of the application code
COPY ./client/ .

# Bake Prisma CLI/Schema engines for the Alpine builder and the Debian
# bookworm runtime (OpenSSL 3). schema.prisma `binaryTargets` only covers the
# Query Engine; CLI engines are resolved at install time for the builder
# platform. This env replaces native detection, so both musl builder
# targets must stay listed — release publishes linux/amd64 and linux/arm64/v8.
# Without the matching glibc engines, entrypoint.sh (`prisma migrate deploy`
# / `prisma generate`) downloads from binaries.prisma.sh and fails air-gapped.
ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x,linux-musl-arm64-openssl-3.0.x,debian-openssl-3.0.x,linux-arm64-openssl-3.0.x

# Install dependencies, generate Prisma client & Build the Next.js application
RUN npm install && npx prisma generate && npm run build


# OTLP receiver build from source - pinned with digest
FROM golang:1.25-alpine@sha256:8e02eb337d9e0ea459e041f1ee5eece41cbb61f1d83e7d883a3e2fb4862063fa AS go-builder

WORKDIR /app/otlp-receiver
COPY ./otlp-receiver/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o otlp-receiver ./cmd/otlp-receiver


# Final runtime image - Node 20 on Debian bookworm (bullseye-security
# package indexes now 404 openssl 1.1.1w updates required by bullseye-slim)
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

ARG TARGETARCH=amd64
ARG TARGETPLATFORM

ENV TARGETARCH=${TARGETARCH}

# Install only the additional runtime dependencies needed.
# Skip Valid-Until so a briefly stale security index cannot fail the image build.
RUN apt-get update -o Acquire::Check-Valid-Until=false && apt-get install -y --no-install-recommends \
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

COPY --from=go-builder /app/otlp-receiver/otlp-receiver /app/otlp-receiver/otlp-receiver

RUN chmod +x ./scripts/entrypoint.sh /app/otlp-receiver/otlp-receiver

# Next.js UI + OTLP HTTP/gRPC
EXPOSE ${DOCKER_PORT:-3000}
EXPOSE 4317
EXPOSE 4318

# Run the entrypoint script
CMD ["/app/client/scripts/entrypoint.sh"]
