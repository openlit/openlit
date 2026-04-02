.PHONY: all build generate setup-bpf test lint clean docker

BINARY   := openlit-collector
CMD_DIR  := ./cmd/collector
BPF_DIR  := ./internal/ebpf

GO       := go

build:
	$(GO) build -o $(BINARY) $(CMD_DIR)

all: setup-bpf generate build

setup-bpf:
	@echo "==> Checking eBPF build dependencies..."
	@command -v clang  >/dev/null 2>&1 || (echo "Installing clang/llvm..." && sudo apt-get update && sudo apt-get install -y clang llvm)
	@(command -v bpftool >/dev/null 2>&1 || test -x /usr/sbin/bpftool) || (echo "Installing bpftool..." && sudo apt-get update && sudo apt-get install -y linux-tools-$$(uname -r) linux-tools-common 2>/dev/null || sudo apt-get install -y bpftool)
	@dpkg -s libbpf-dev >/dev/null 2>&1 || (echo "Installing libbpf-dev..." && sudo apt-get update && sudo apt-get install -y libbpf-dev)
	@echo "==> Generating vmlinux.h from kernel BTF..."
	bash -c 'BPFTOOL=$$(command -v bpftool 2>/dev/null || echo /usr/sbin/bpftool); $$BPFTOOL btf dump file /sys/kernel/btf/vmlinux format c > $(BPF_DIR)/bpf/vmlinux.h'
	@echo "==> Copying libbpf headers..."
	cp /usr/include/bpf/bpf_helpers.h    $(BPF_DIR)/bpf/
	cp /usr/include/bpf/bpf_helper_defs.h $(BPF_DIR)/bpf/
	cp /usr/include/bpf/bpf_tracing.h    $(BPF_DIR)/bpf/
	-cp /usr/include/bpf/bpf_core_read.h  $(BPF_DIR)/bpf/ 2>/dev/null
	-cp /usr/include/bpf/bpf_endian.h     $(BPF_DIR)/bpf/ 2>/dev/null
	@echo "==> eBPF headers ready."

generate:
	cd $(BPF_DIR) && $(GO) generate ./...

test:
	$(GO) test ./...

lint:
	golangci-lint run ./...

clean:
	rm -f $(BINARY)
	rm -f $(BPF_DIR)/gpuevent_bpfel*.go $(BPF_DIR)/gpuevent_bpfel*.o
	rm -f $(BPF_DIR)/bpf/vmlinux.h
	rm -f $(BPF_DIR)/bpf/bpf_helpers.h $(BPF_DIR)/bpf/bpf_helper_defs.h
	rm -f $(BPF_DIR)/bpf/bpf_tracing.h $(BPF_DIR)/bpf/bpf_core_read.h $(BPF_DIR)/bpf/bpf_endian.h

docker:
	docker build -t openlit-collector:latest .
