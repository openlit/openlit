.PHONY: build generate test lint clean docker

BINARY   := openlit-collector
CMD_DIR  := ./cmd/collector
BPF_DIR  := ./internal/ebpf

GO       := go
CLANG    := clang
CFLAGS   := -O2 -g -Wall -target bpf

build:
	CGO_ENABLED=0 $(GO) build -o $(BINARY) $(CMD_DIR)

generate:
	cd $(BPF_DIR) && $(GO) generate ./...

test:
	$(GO) test ./...

lint:
	golangci-lint run ./...

clean:
	rm -f $(BINARY)

docker:
	docker build -t openlit-collector:latest .
