# Multi-stage build for the openlit CLI.
#
# Stage 1 produces a statically-linked binary so the runtime image needs no
# Go toolchain. Stage 2 ships a tiny distroless image with git + bash so the
# survival-rework + scan-repo workers can shell out to git locally.

ARG GO_VERSION=1.25

FROM golang:${GO_VERSION}-alpine AS build
RUN apk add --no-cache git ca-certificates
WORKDIR /src

# Copy the cli and sdk modules together so the `replace` directive can
# resolve sdk/go locally.
COPY cli/ ./cli
COPY sdk/go/ ./sdk/go
WORKDIR /src/cli
RUN go mod download
ARG VERSION=dev
ARG COMMIT=unknown
# Version vars live in cli/internal/version, not in `main`. Targeting
# main.Version made -X a silent no-op — every image printed `dev`.
ARG VERSION_PKG=github.com/openlit/openlit/cli/internal/version
RUN CGO_ENABLED=0 GOOS=linux \
	go build -trimpath -ldflags "-s -w -X ${VERSION_PKG}.Version=${VERSION} -X ${VERSION_PKG}.Commit=${COMMIT}" \
	-o /out/openlit ./cmd/openlit

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates bash \
	&& rm -rf /var/lib/apt/lists/*
# Optional: install gitleaks + semgrep so `openlit scan-repo` works out of the
# box. They are large so we keep them optional via the BUILD_WITH_SCANNERS arg.
ARG BUILD_WITH_SCANNERS=false
RUN if [ "$BUILD_WITH_SCANNERS" = "true" ]; then \
	apt-get update && apt-get install -y --no-install-recommends curl python3-pip \
	&& curl -sSL https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_8.21.2_linux_x64.tar.gz \
		| tar -xz -C /usr/local/bin gitleaks \
	&& pip3 install --no-cache-dir --break-system-packages semgrep \
	&& apt-get purge -y curl python3-pip \
	&& apt-get autoremove -y \
	&& rm -rf /var/lib/apt/lists/*; \
	fi
COPY --from=build /out/openlit /usr/local/bin/openlit
ENTRYPOINT ["/usr/local/bin/openlit"]
CMD ["--help"]
