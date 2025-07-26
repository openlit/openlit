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
COPY . .

# Copying otel collector config
# COPY ../assets/otel-collector-config.yaml /etc/otel/config.yaml
# COPY ../assets/supervisor.yaml /etc/otel/supervisor.yaml

# Install dependencies & Build the Next.js application
RUN npm install && npm run build


# Use a smaller image for production
FROM alpine


# Copy from otel collector bases
COPY --from=otel_collector_base --chmod=755 /otelcol-contrib /otelcontribcol
COPY --from=otel_collector_opampsupervisor_base --chmod=755 /usr/local/bin/opampsupervisor /usr/local/bin/opampsupervisor

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

# Set up Otel Collector
# COPY --from=builder /etc/otel/config.yaml /etc/otel/config.yaml
# COPY --from=builder /etc/otel/supervisor.yaml  /etc/otel/supervisor.yaml

RUN mkdir -p /etc/otel/supervisor-data && \
    rm -rf /var/cache/apk/*

# Execute entrypoint script to generate NextAuth.js secret and run commands
RUN chmod +x ./scripts/entrypoint.sh

# Install Prisma globally
# RUN npm install -g prisma@5.15.0

# Expose the port that Next.js will run on
EXPOSE 4317 4318 13133 55679 ${DOCKER_PORT:-3000}

# Run the entrypoint script
CMD ["/app/client/scripts/entrypoint.sh"]
