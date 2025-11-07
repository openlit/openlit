# Use an alpine as a base image
FROM alpine AS builder

# Build arguments for configurable versions
ARG OTEL_VERSION=v0.132.0
ARG OPAMP_SUPERVISOR_VERSION=v0.132.0
ARG TARGETARCH=arm64

# Installing node and npm
RUN apk add --update nodejs npm


# Installing extra packages
RUN apk add --no-cache python3 py3-pip pipx rust cargo build-base


# Create a virtual environment
RUN python3 -m venv /app/client/venv

# Install litellm inside the virtual environment
RUN /app/client/venv/bin/pip install --no-cache-dir litellm

RUN find /app/client/venv -name '*.pyc' -delete && \
    find /app/client/venv -name '__pycache__' -type d -exec rm -r {} +


# Set the working directory in the container
WORKDIR /app/client

# Copy package.json and package-lock.json to the working directory & the rest of the application code
COPY ./client/ .

# Install dependencies & Build the Next.js application
RUN npm install && npm run build


# Opamp server build from source
FROM golang:1.25-alpine AS go-builder

# Set working directory for opamp-server
WORKDIR /app/opamp-server

# Copy the rest of the opamp-server source code
COPY ./opamp-server/ ./

# Build the opamp-server binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o opamp-server .

# OpenTelemetry Collector Contrib download
FROM alpine AS otel-downloader

# Accept build arguments
ARG OTEL_VERSION=v0.132.4
ARG OPAMP_SUPERVISOR_VERSION=v0.126.0
ARG TARGETARCH=arm64

# Install curl for downloading binaries
RUN apk add --no-cache curl

# Set working directory
WORKDIR /tmp

# Download OpenTelemetry Collector Contrib
RUN curl -LO "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/${OTEL_VERSION}/otelcol-contrib_${OTEL_VERSION#v}_linux_${TARGETARCH}.tar.gz" && \
    tar -xzf "otelcol-contrib_${OTEL_VERSION#v}_linux_${TARGETARCH}.tar.gz" && \
    chmod +x otelcol-contrib

# Download OpAMP Supervisor
RUN curl --proto '=https' --tlsv1.2 -fL -o opampsupervisor \
    "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/cmd%2Fopampsupervisor%2F${OPAMP_SUPERVISOR_VERSION}/opampsupervisor_${OPAMP_SUPERVISOR_VERSION#v}_linux_${TARGETARCH}" && \
    chmod +x opampsupervisor


# Use a smaller image for production
FROM alpine

# Installing extra packages
RUN apk add nodejs bash openssl python3


# Set the working directory in the container
WORKDIR /app/client

# Copy only necessary files from the builder stage

# Copying python virtual environment
COPY --from=builder /app/client/venv ./venv
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

# Execute entrypoint script to generate NextAuth.js secret and run commands
RUN chmod +x ./scripts/entrypoint.sh /app/opamp/otelcontribcol /app/opamp/opampsupervisor /app/opamp/opamp-server /app/opamp/setup-supervisor.sh
RUN chmod -R u=rwX,go= /app/opamp/certs

# Expose the port that Next.js will run on
EXPOSE ${DOCKER_PORT:-3000}

# Run the entrypoint script
CMD ["/app/client/scripts/entrypoint.sh"]