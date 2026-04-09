VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -ldflags "-X github.com/openlit/openlit/openlit-collector/internal/server.Version=$(VERSION)"
SCANNER_DIR := ./internal/scanner

UNAME_M := $(shell uname -m)
ifeq ($(UNAME_M),x86_64)
    BPF_TARGET_ARCH := x86
else ifeq ($(UNAME_M),aarch64)
    BPF_TARGET_ARCH := arm64
else
    BPF_TARGET_ARCH := $(UNAME_M)
endif

.PHONY: setup-bpf
setup-bpf:
	bpftool btf dump file /sys/kernel/btf/vmlinux format c > $(SCANNER_DIR)/bpf/vmlinux.h
	cp /usr/include/bpf/bpf_helpers.h $(SCANNER_DIR)/bpf/
	cp /usr/include/bpf/bpf_helper_defs.h $(SCANNER_DIR)/bpf/
	cp /usr/include/bpf/bpf_tracing.h $(SCANNER_DIR)/bpf/

.PHONY: generate
generate:
	cd $(SCANNER_DIR) && GOPACKAGE=scanner go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -target bpfel llmScanner ./bpf/llm_scanner.bpf.c -- -I./bpf -D__TARGET_ARCH_$(BPF_TARGET_ARCH)

.PHONY: build
build:
	CGO_ENABLED=0 go build $(LDFLAGS) -o openlit-collector ./cmd/collector

.PHONY: build-linux-amd64
build-linux-amd64:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o dist/openlit-collector-linux-amd64 ./cmd/collector

.PHONY: build-linux-arm64
build-linux-arm64:
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o dist/openlit-collector-linux-arm64 ./cmd/collector

.PHONY: release
release: build-linux-amd64 build-linux-arm64
	cd dist && sha256sum openlit-collector-* > SHA256SUMS

.PHONY: docker
docker:
	docker build -t ghcr.io/openlit/openlit-collector:$(VERSION) .

.PHONY: test
test:
	go test ./...

.PHONY: lint
lint:
	golangci-lint run ./...

.PHONY: vendor-providers
vendor-providers:
	@echo "==> Checking out OBI submodule..."
	git submodule update --init --checkout .obi-src
	@echo "==> Copying provider parser files..."
	@for dir in providers/*/; do \
		provider=$$(basename $$dir); \
		for gofile in $$dir*.go; do \
			[ -f "$$gofile" ] || continue; \
			case "$$gofile" in *_test.go) continue;; esac; \
			echo "  cp $$gofile -> .obi-src/pkg/ebpf/common/http/"; \
			cp $$gofile .obi-src/pkg/ebpf/common/http/; \
		done; \
	done
	@echo "==> Applying patches..."
	@for patch in patches/*.patch; do \
		[ -f "$$patch" ] || continue; \
		echo "  applying $$patch"; \
		cd .obi-src && git apply ../$$patch && cd ..; \
	done
	@echo "==> Done. Run 'make build' to compile."

.PHONY: update-obi
update-obi:
	git submodule update --checkout --remote .obi-src
	$(MAKE) vendor-providers

.PHONY: clean
clean:
	rm -f openlit-collector
	rm -rf dist/
