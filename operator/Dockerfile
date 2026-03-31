# OpenLIT Kubernetes Operator Container Image
#
# This Dockerfile builds the OpenLIT operator that provides zero-code
# instrumentation for applications running in Kubernetes clusters.
#
# The operator automatically injects OpenTelemetry instrumentation into
# pods based on AutoInstrumentation Custom Resources, supporting multiple
# providers including OpenLIT, OpenInference, and OpenLLMetry.
#
# Build stages:
# 1. Builder: Compiles the Go operator binary with static linking
# 2. Runtime: Minimal Alpine image with the operator binary
#
# Usage:
#   docker build -t openlit-operator:latest .
#   docker run openlit-operator:latest
#
# Multi-arch build (amd64 + arm64):
#   docker buildx build --platform linux/amd64,linux/arm64 -t openlit-operator:latest .
#
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS builder

ARG TARGETOS=linux
ARG TARGETARCH

# Install git for go mod download
RUN apk add --no-cache git

WORKDIR /workspace

# Copy go mod and sum files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy the source code
COPY . .

# Build the operator for the target platform (cross-compiled from build platform)
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -a -o operator ./cmd/operator

# Final stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy the operator binary
COPY --from=builder /workspace/operator .

ENTRYPOINT ["./operator"]