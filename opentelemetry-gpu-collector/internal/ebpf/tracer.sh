#!/bin/sh
ARCH=$(uname -m | sed 's/x86_64/x86/;s/aarch64/arm64/')
go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -target bpfel gpuevent ./bpf/gpuevent.c -- -I./bpf -D__TARGET_ARCH_${ARCH}
