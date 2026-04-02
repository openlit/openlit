# Stage 1: Build the eBPF programs and Go binary
FROM golang:1.25-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    clang \
    llvm \
    libbpf-dev \
    linux-headers-generic \
    make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Generate eBPF Go bindings (only needed if bpf C sources changed)
# RUN make generate

# Build the collector binary
RUN CGO_ENABLED=0 GOOS=linux go build -o /openlit-collector ./cmd/collector/

# Stage 2: Minimal runtime image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /openlit-collector /usr/local/bin/openlit-collector

ENV GPU_APPLICATION_NAME=default
ENV GPU_ENVIRONMENT=default

ENTRYPOINT ["/usr/local/bin/openlit-collector"]
