.PHONY: all build generate setup-bpf test lint clean docker

BINARY   := opentelemetry-gpu-collector
CMD_DIR  := ./cmd/collector
BPF_DIR  := ./internal/ebpf

GO       := go

build:
	$(GO) build -o $(BINARY) $(CMD_DIR)

all: setup-bpf generate build

setup-bpf:
	@echo "==> Checking eBPF build dependencies..."
	@command -v clang  >/dev/null 2>&1 || (echo "Installing clang/llvm..." && sudo apt-get update && sudo apt-get install -y clang llvm)
	@command -v bpftool >/dev/null 2>&1 || { echo "bpftool not found. Download from https://github.com/libbpf/bpftool/releases or install linux-tools-generic" && exit 1; }
	@dpkg -s libbpf-dev >/dev/null 2>&1 || (echo "Installing libbpf-dev..." && sudo apt-get update && sudo apt-get install -y libbpf-dev)
	@echo "==> Generating vmlinux.h from kernel BTF..."
	bpftool btf dump file /sys/kernel/btf/vmlinux format c > $(BPF_DIR)/bpf/vmlinux.h
	@# Cross-arch shim: vmlinux.h only contains the build host's kernel types,
	@# but bpf2go runs clang once per -target arch (amd64 + arm64). When the
	@# arm64 pass runs on a non-arm64 host, libbpf's bpf_tracing.h references
	@# struct user_pt_regs which the host BTF lacks. Append the canonical arm64
	@# layout (arch/arm64/include/uapi/asm/ptrace.h) if vmlinux.h doesn't
	@# already define it. Idempotent: the grep guard prevents redefinition
	@# when this host's BTF (e.g. native arm64) already provides the struct.
	@if ! grep -q 'struct user_pt_regs' $(BPF_DIR)/bpf/vmlinux.h; then \
		printf '\n/* openlit cross-arch BPF shim: arm64 user_pt_regs missing from host BTF */\nstruct user_pt_regs {\n\t__u64 regs[31];\n\t__u64 sp;\n\t__u64 pc;\n\t__u64 pstate;\n};\n' >> $(BPF_DIR)/bpf/vmlinux.h; \
	fi
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
	# bpf2go output stems are always "<linux>_<clang>" (clang = bpfel|bpfeb),
	# so restricting to those endings avoids deleting any hand-written file
	# that might one day live alongside the generated ones.
	rm -f $(BPF_DIR)/gpuevent_*bpfel.go $(BPF_DIR)/gpuevent_*bpfel.o
	rm -f $(BPF_DIR)/gpuevent_*bpfeb.go $(BPF_DIR)/gpuevent_*bpfeb.o
	rm -f $(BPF_DIR)/bpf/vmlinux.h
	rm -f $(BPF_DIR)/bpf/bpf_helpers.h $(BPF_DIR)/bpf/bpf_helper_defs.h
	rm -f $(BPF_DIR)/bpf/bpf_tracing.h $(BPF_DIR)/bpf/bpf_core_read.h $(BPF_DIR)/bpf/bpf_endian.h

docker:
	docker build -t opentelemetry-gpu-collector:latest .
