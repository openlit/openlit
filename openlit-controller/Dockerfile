# --- Build OBI from source (with multi-provider GenAI support) ---
FROM ghcr.io/open-telemetry/obi-generator:0.2.11 AS obi-builder

ARG OBI_REPO=https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation.git
ARG OBI_BRANCH=v0.9.0
ARG TARGETARCH

ENV GOARCH=${TARGETARCH}
# OBI v0.9.0 requires Go >= 1.25.9, newer than the obi-generator base image's
# pinned toolchain. Allow Go to auto-download the toolchain its go.mod requests.
ENV GOTOOLCHAIN=auto

WORKDIR /obi-src

RUN apk add --no-cache make git bash

RUN git clone --depth 1 --branch ${OBI_BRANCH} ${OBI_REPO} .

# Vendor our standalone provider parsers (new files, not patches) into the OBI
# HTTP package, then apply patches that wire them in + add config/span fields.
COPY _obi-providers/ /tmp/providers/
RUN for gofile in /tmp/providers/*/*.go; do \
      [ -f "$gofile" ] || continue; \
      case "$gofile" in *_test.go) continue;; esac; \
      echo "Vendoring $gofile"; \
      cp "$gofile" pkg/ebpf/common/http/; \
    done

COPY patches/ /tmp/patches/
RUN for patch in /tmp/patches/*.patch; do \
      [ -f "$patch" ] || continue; \
      echo "Applying $patch"; \
      git apply "$patch"; \
    done

RUN go mod download
RUN /generate.sh && \
    CGO_ENABLED=0 GOOS=linux go build -a -o /obi ./cmd/obi

# --- Build controller ---
FROM golang:1.24-bookworm AS builder

ARG VERSION=dev

RUN apt-get update && apt-get install -y --no-install-recommends \
    clang llvm libbpf-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN make setup-bpf-headers generate

RUN CGO_ENABLED=0 go build -ldflags "-s -w -X github.com/openlit/openlit/openlit-controller/internal/server.Version=${VERSION}" \
    -o openlit-controller ./cmd/controller

# --- Runtime ---
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=obi-builder /obi /usr/local/bin/obi
COPY --from=builder /build/openlit-controller /usr/local/bin/openlit-controller

EXPOSE 4321

ENTRYPOINT ["openlit-controller"]
