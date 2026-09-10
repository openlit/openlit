//go:build linux

package cpupmu

import (
	"encoding/binary"
	"fmt"
	"log/slog"
	"runtime"
	"unsafe"

	"golang.org/x/sys/unix"
)

type perfEvent struct {
	spec EventSpec
	fds  []int // one per CPU
}

type perfReader struct {
	logger    *slog.Logger
	events    []perfEvent
	available bool
}

// newPlatformReader opens perf events system-wide (per-CPU aggregated).
// Soft-fails without CAP_PERFMON / permissive perf_event_paranoid.
func newPlatformReader(specs []EventSpec, logger *slog.Logger) Reader {
	r := &perfReader{logger: logger}
	ncpu := runtime.NumCPU()
	if ncpu < 1 {
		ncpu = 1
	}

	for _, spec := range specs {
		attr, ok := buildAttr(spec)
		if !ok {
			logger.Debug("unsupported pmu event", "name", spec.Name, "attrs", spec.Attrs)
			continue
		}
		var fds []int
		for cpu := 0; cpu < ncpu; cpu++ {
			fd, err := unix.PerfEventOpen(&attr, -1, cpu, -1, 0)
			if err != nil {
				logger.Debug("perf_event_open failed",
					"event", spec.Name, "cpu", cpu, "error", err)
				continue
			}
			fds = append(fds, fd)
		}
		if len(fds) == 0 {
			continue
		}
		r.events = append(r.events, perfEvent{spec: spec, fds: fds})
	}
	r.available = len(r.events) > 0
	if !r.available {
		logger.Warn("CPU PMU unavailable (need CAP_PERFMON or lower perf_event_paranoid)")
	}
	return r
}

func buildAttr(spec EventSpec) (unix.PerfEventAttr, bool) {
	attr := unix.PerfEventAttr{
		Size:   uint32(unsafe.Sizeof(unix.PerfEventAttr{})),
		Read_format: unix.PERF_FORMAT_TOTAL_TIME_ENABLED | unix.PERF_FORMAT_TOTAL_TIME_RUNNING,
		Bits:   unix.PerfBitDisabled | unix.PerfBitInherit,
	}
	// Enable immediately after open via ioctl; start disabled to set flags cleanly.
	switch spec.Name {
	case "instructions":
		attr.Type = unix.PERF_TYPE_HARDWARE
		attr.Config = unix.PERF_COUNT_HW_INSTRUCTIONS
	case "cycles":
		attr.Type = unix.PERF_TYPE_HARDWARE
		attr.Config = unix.PERF_COUNT_HW_CPU_CYCLES
	case "cache":
		attr.Type = unix.PERF_TYPE_HW_CACHE
		cfg, ok := cacheConfig(spec.Attrs)
		if !ok {
			return attr, false
		}
		attr.Config = cfg
	case "tlb":
		attr.Type = unix.PERF_TYPE_HW_CACHE
		cfg, ok := tlbConfig(spec.Attrs)
		if !ok {
			return attr, false
		}
		attr.Config = cfg
	case "branch":
		attr.Type = unix.PERF_TYPE_HARDWARE
		switch spec.Attrs["hw.cpu.branch.result"] {
		case "mispredicted":
			attr.Config = unix.PERF_COUNT_HW_BRANCH_MISSES
		default:
			attr.Config = unix.PERF_COUNT_HW_BRANCH_INSTRUCTIONS
		}
	default:
		return attr, false
	}
	// Clear disabled so counting starts on open.
	attr.Bits &^= unix.PerfBitDisabled
	return attr, true
}

func cacheConfig(attrs map[string]string) (uint64, bool) {
	level := attrs["hw.cpu.cache.level"]
	op := attrs["hw.cpu.cache.op"]
	var cache uint64
	switch level {
	case "l1i":
		cache = unix.PERF_COUNT_HW_CACHE_L1I
	case "l1d", "l1":
		cache = unix.PERF_COUNT_HW_CACHE_L1D
	case "l2":
		// No dedicated L2; use LL as best-effort.
		cache = unix.PERF_COUNT_HW_CACHE_LL
	case "l3", "ll":
		cache = unix.PERF_COUNT_HW_CACHE_LL
	default:
		return 0, false
	}
	var result uint64 = unix.PERF_COUNT_HW_CACHE_RESULT_ACCESS
	if op == "miss" {
		result = unix.PERF_COUNT_HW_CACHE_RESULT_MISS
	}
	cfg := cache | (unix.PERF_COUNT_HW_CACHE_OP_READ << 8) | (result << 16)
	return cfg, true
}

func tlbConfig(attrs map[string]string) (uint64, bool) {
	level := attrs["hw.cpu.tlb.level"]
	op := attrs["hw.cpu.tlb.op"]
	var cache uint64
	switch level {
	case "itlb":
		cache = unix.PERF_COUNT_HW_CACHE_ITLB
	default:
		cache = unix.PERF_COUNT_HW_CACHE_DTLB
	}
	var result uint64 = unix.PERF_COUNT_HW_CACHE_RESULT_ACCESS
	if op == "miss" || op == "walk" {
		result = unix.PERF_COUNT_HW_CACHE_RESULT_MISS
	}
	cfg := cache | (unix.PERF_COUNT_HW_CACHE_OP_READ << 8) | (result << 16)
	return cfg, true
}

func (r *perfReader) Available() bool { return r.available }

func (r *perfReader) Read() ([]Sample, error) {
	if !r.available {
		return nil, fmt.Errorf("pmu unavailable")
	}
	out := make([]Sample, 0, len(r.events))
	for _, ev := range r.events {
		var total uint64
		for _, fd := range ev.fds {
			v, err := readPerfCounter(fd)
			if err != nil {
				r.logger.Debug("perf read failed", "event", ev.spec.Name, "error", err)
				continue
			}
			total += v
		}
		out = append(out, Sample{Name: ev.spec.Name, Value: total, Attrs: ev.spec.Attrs})
	}
	return out, nil
}

func (r *perfReader) Close() error {
	for _, ev := range r.events {
		for _, fd := range ev.fds {
			_ = unix.Close(fd)
		}
	}
	r.events = nil
	r.available = false
	return nil
}

func readPerfCounter(fd int) (uint64, error) {
	// value, time_enabled, time_running
	var buf [24]byte
	n, err := unix.Read(fd, buf[:])
	if err != nil {
		return 0, err
	}
	if n < 24 {
		return 0, fmt.Errorf("short perf read: %d", n)
	}
	value := binary.LittleEndian.Uint64(buf[0:8])
	enabled := binary.LittleEndian.Uint64(buf[8:16])
	running := binary.LittleEndian.Uint64(buf[16:24])
	if running == 0 || enabled == 0 {
		return value, nil
	}
	// Scale for multiplexing: value * time_enabled / time_running
	return value * enabled / running, nil
}
