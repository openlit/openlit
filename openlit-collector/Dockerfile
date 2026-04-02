# Stage 1: Build the eBPF programs and Go binary
FROM golang:1.25-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    clang \
    llvm \
    libbpf-dev \
    bpftool \
    make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Generate eBPF Go bindings.
# vmlinux.h is generated from the build host's kernel BTF; at runtime the
# eBPF verifier uses the actual host kernel's BTF for CO-RE relocations.
RUN if [ -f /sys/kernel/btf/vmlinux ]; then \
      make setup-bpf && make generate; \
    else \
      echo "WARNING: /sys/kernel/btf/vmlinux not available — skipping eBPF generation. Pre-generated bindings must exist."; \
    fi

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
