package ebpf

import "errors"

// ErrUnsupported indicates the host cannot run eBPF CUDA tracing
// (non-Linux, missing CAP_BPF/CAP_PERFMON, memlock, old kernel, missing BTF).
// Callers should treat this as environment unavailability, not a collector fault.
// loadGpuevent() failures (corrupt/missing embedded BPF object) are NOT wrapped.
var ErrUnsupported = errors.New("eBPF CUDA tracing unsupported on this host")
