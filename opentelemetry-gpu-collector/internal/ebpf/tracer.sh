#!/usr/bin/env bash

# Host-arch-aware bpf2go wrapper, invoked by the //go:generate
# directive in tracer.go.
#
# setup-bpf dumps the *host* kernel BTF into a single vmlinux.h,
# which is inherently single-arch. libbpf's arm64 register path
# reads a separate `struct user_pt_regs` (which the setup-bpf
# shim in Makefile supplies), so an x86 host can cross-generate
# arm64. The x86 path reads members straight off `struct pt_regs`
# so an arm64 host cannot generate the x86 object. Derive the
# target list from the host arch accordingly.

set -e

case "$(uname -m)" in
	x86_64)  targets=amd64,arm64 ;;
	aarch64) targets=arm64 ;;
	*)       targets="$(go env GOARCH)" ;;
esac

exec go run github.com/cilium/ebpf/cmd/bpf2go -cc clang \
	-target "$targets" gpuevent ./bpf/gpuevent.c -- -I./bpf
