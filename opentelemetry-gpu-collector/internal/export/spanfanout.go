package export

import (
	"context"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/cudaspans"
	gpuebpf "github.com/openlit/openlit/opentelemetry-gpu-collector/internal/ebpf"
)

// SpanFanout is the single eBPF event handler for activity + occupancy + duration.
// Occupancy Engine owns the launch→sync buffer; closed spans feed gpu.kernel.duration.
type SpanFanout struct {
	ebpf *EBPFMetrics
	occ  *OccupancyMetrics
}

// NewSpanFanout wires activity metrics and occupancy to one handler.
func NewSpanFanout(ebpf *EBPFMetrics, occ *OccupancyMetrics) *SpanFanout {
	return &SpanFanout{ebpf: ebpf, occ: occ}
}

// HandleEvent implements gpuebpf.EventHandler.
func (f *SpanFanout) HandleEvent(ev gpuebpf.CUDAEvent) {
	ctx := context.Background()
	switch e := ev.(type) {
	case *gpuebpf.SetDeviceEvent:
		if f.occ != nil {
			f.occ.HandleEvent(ev)
		} else if f.ebpf != nil && f.ebpf.devices != nil {
			f.ebpf.devices.NoteSetDevice(e.PID, e.TID, int(e.Device))
		}

	case *gpuebpf.KernelLaunchEvent:
		if f.ebpf != nil {
			f.ebpf.RecordLaunchActivity(ctx, e)
		}
		if f.occ != nil {
			f.occ.HandleEvent(ev)
			if f.ebpf != nil {
				f.ebpf.RecordClosedSpans(ctx, f.occ.TakeClosedSpans())
			}
		}

	case *gpuebpf.SyncEvent:
		if f.occ != nil {
			f.occ.HandleEvent(ev)
			if f.ebpf != nil {
				f.ebpf.RecordClosedSpans(ctx, f.occ.TakeClosedSpans())
			}
		}

	case *gpuebpf.MallocEvent, *gpuebpf.MemcpyEvent:
		if f.ebpf != nil {
			f.ebpf.HandleEvent(ev)
		}
	}
}

// TakeClosedSpans drains per-launch closes from the occupancy engine.
func (om *OccupancyMetrics) TakeClosedSpans() []cudaspans.ClosedSpan {
	if om == nil || om.engine == nil {
		return nil
	}
	return om.engine.TakeClosedSpans()
}
