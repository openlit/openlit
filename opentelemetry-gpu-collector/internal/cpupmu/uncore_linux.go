//go:build linux

package cpupmu

import (
	"fmt"
	"log/slog"
	"strings"
	"unsafe"

	"golang.org/x/sys/unix"
)

// Intel IMC cas_count_* counts cache-line (64B) transactions.
const imcCASBytes = 64

type uncoreEvent struct {
	spec  EventSpec
	fds   []int
	scale uint64
}

type uncoreReader struct {
	logger    *slog.Logger
	events    []uncoreEvent
	available bool
}

// newUncoreReader discovers IMC / UMC uncore devices and opens counting-mode
// read/write bandwidth events (package-scoped; few FDs, low overhead).
func newUncoreReader(logger *slog.Logger) Reader {
	r := &uncoreReader{logger: logger}
	devs := discoverUncoreIMCs("/sys/bus/event_source/devices")
	if len(devs) == 0 {
		logger.Info("uncore memory bandwidth unavailable (no uncore_imc*/amd_umc* devices)")
		return r
	}

	for _, dev := range devs {
		for _, pair := range []struct {
			eventName string
			direction string
		}{
			{"cas_count_read", "receive"},
			{"cas_count_write", "transmit"},
			{"mem_read", "receive"},
			{"mem_write", "transmit"},
		} {
			cfg, ok := readUncoreEventConfig(dev.path, pair.eventName)
			if !ok {
				continue
			}
			cpus := parseCPUMask(dev.cpumask)
			if len(cpus) == 0 {
				cpus = []int{0}
			}
			attr := unix.PerfEventAttr{
				Type:        dev.pmuType,
				Size:        uint32(unsafe.Sizeof(unix.PerfEventAttr{})),
				Config:      cfg,
				Read_format: unix.PERF_FORMAT_TOTAL_TIME_ENABLED | unix.PERF_FORMAT_TOTAL_TIME_RUNNING,
			}
			var fds []int
			for _, cpu := range cpus {
				fd, err := unix.PerfEventOpen(&attr, -1, cpu, -1, 0)
				if err != nil {
					logger.Debug("uncore perf_event_open failed",
						"device", dev.name, "event", pair.eventName, "cpu", cpu, "error", err)
					continue
				}
				fds = append(fds, fd)
			}
			if len(fds) == 0 {
				continue
			}
			scale := uint64(1)
			if strings.HasPrefix(pair.eventName, "cas_count_") {
				scale = imcCASBytes
			}
			r.events = append(r.events, uncoreEvent{
				spec: EventSpec{
					Name: "memory_io",
					Attrs: map[string]string{
						"network.io.direction":        pair.direction,
						"hw.cpu.memory.controller":    dev.name,
					},
				},
				fds:   fds,
				scale: scale,
			})
		}
	}

	r.available = len(r.events) > 0
	if r.available {
		logger.Info("uncore memory bandwidth enabled", "events", len(r.events), "devices", len(devs))
	} else {
		logger.Info("uncore devices found but no bandwidth events opened")
	}
	return r
}

func (r *uncoreReader) Available() bool { return r.available }

func (r *uncoreReader) Read() ([]Sample, error) {
	if !r.available {
		return nil, fmt.Errorf("uncore unavailable")
	}
	out := make([]Sample, 0, len(r.events))
	for _, ev := range r.events {
		var total uint64
		for _, fd := range ev.fds {
			v, err := readPerfCounter(fd)
			if err != nil {
				r.logger.Debug("uncore read failed", "event", ev.spec.Attrs, "error", err)
				continue
			}
			total += v
		}
		if ev.scale > 1 {
			total *= ev.scale
		}
		out = append(out, Sample{Name: ev.spec.Name, Value: total, Attrs: ev.spec.Attrs})
	}
	return out, nil
}

func (r *uncoreReader) Close() error {
	for _, ev := range r.events {
		for _, fd := range ev.fds {
			_ = unix.Close(fd)
		}
	}
	r.events = nil
	r.available = false
	return nil
}
