ARG OTEL_COLLECTOR_VERSION=0.129.1
ARG OTEL_COLLECTOR_OPAMPSUPERVISOR_VERSION=0.128.0
# base #############################################################################################
# == Otel Collector Image ==
FROM otel/opentelemetry-collector-contrib:${OTEL_COLLECTOR_VERSION} AS otel_collector_base
FROM otel/opentelemetry-collector-opampsupervisor:${OTEL_COLLECTOR_OPAMPSUPERVISOR_VERSION} AS otel_collector_opampsupervisor_base

# Use an alpine as a base image
FROM alpine AS builder

# Installing node and npm
RUN apk add --update nodejs npm


# Installing build dependencies
RUN apk add --no-cache python3 py3-pip rust cargo build-base

# Create optimized virtual environment
RUN python3 -m venv /app/client/venv && \
    /app/client/venv/bin/pip install --no-cache-dir --no-deps litellm && \
    /app/client/venv/bin/pip install --no-cache-dir requests httpx && \
    find /app/client/venv -name '*.pyc' -delete && \
    find /app/client/venv -name '__pycache__' -type d -exec rm -r {} + && \
    find /app/client/venv -name '*.dist-info' -type d -exec rm -r {} + 2>/dev/null || true && \
    find /app/client/venv -name 'tests' -type d -exec rm -r {} + 2>/dev/null || true


# Set the working directory in the container
WORKDIR /app/client

# Copy package.json and package-lock.json to the working directory & the rest of the application code
COPY . .

# Copying otel collector config
# COPY ../assets/otel-collector-config.yaml /etc/otel/config.yaml
# COPY ../assets/supervisor.yaml /etc/otel/supervisor.yaml

# Install dependencies & Build the Next.js application
RUN npm ci && \
    npm run build && \
    npm prune --production && \
    npm cache clean --force


# Use a smaller image for production
FROM alpine


# Copy from otel collector and opamp components
COPY --from=otel_collector_base --chmod=755 /otelcol-contrib /otelcontribcol
COPY --from=otel_collector_opampsupervisor_base --chmod=755 /usr/local/bin/opampsupervisor /usr/local/bin/opampsupervisor

# Installing only necessary runtime packages
RUN apk add --no-cache nodejs bash python3 openssl


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

# Set up Otel Collector
# COPY --from=builder /etc/otel/config.yaml /etc/otel/config.yaml
# COPY --from=builder /etc/otel/supervisor.yaml  /etc/otel/supervisor.yaml

# Create directories and cleanup in one layer
RUN mkdir -p /etc/otel/supervisor-data && \
    chmod +x ./scripts/entrypoint.sh && \
    rm -rf /var/cache/apk/* /tmp/* /var/tmp/*

# Install Prisma globally
# RUN npm install -g prisma@5.15.0

# Expose the port that Next.js will run on
EXPOSE 4317 4318 13133 55679 4320 ${DOCKER_PORT:-3000}

# Run the entrypoint script
CMD ["/app/client/scripts/entrypoint.sh"]
