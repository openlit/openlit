package export

import (
	"context"
	"fmt"
	"testing"

	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	gpuebpf "github.com/openlit/openlit/opentelemetry-gpu-collector/internal/ebpf"
)

func newTestSpanFanout(t *testing.T) (*SpanFanout, *metric.ManualReader, func()) {
	t.Helper()
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	em, err := NewEBPFMetrics(provider, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	occ, err := NewOccupancyMetrics(provider, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	return NewSpanFanout(em, occ), reader, func() {
		occ.Close()
		_ = provider.Shutdown(context.Background())
	}
}

func TestKernelDurationLaunchToSync(t *testing.T) {
	fanout, reader, cleanup := newTestSpanFanout(t)
	defer cleanup()

	launch := &gpuebpf.KernelLaunchEvent{KernelName: "matmul"}
	launch.PID = 10
	launch.TID = 11
	launch.StreamID = 7
	launch.KtimeNs = 1_000_000_000
	fanout.HandleEvent(launch)

	sync := &gpuebpf.SyncEvent{}
	sync.PID = 10
	sync.TID = 11
	sync.StreamID = 7
	sync.KtimeNs = 1_500_000_000
	fanout.HandleEvent(sync)

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != "gpu.kernel.duration" {
				continue
			}
			hist, ok := m.Data.(metricdata.Histogram[float64])
			if !ok {
				t.Fatalf("unexpected data type %T", m.Data)
			}
			for _, dp := range hist.DataPoints {
				if dp.Count != 1 {
					t.Fatalf("count = %d, want 1", dp.Count)
				}
				if dp.Sum < 0.49 || dp.Sum > 0.51 {
					t.Fatalf("sum = %v, want ~0.5s", dp.Sum)
				}
				found = true
			}
		}
	}
	if !found {
		t.Fatal("gpu.kernel.duration not recorded")
	}
}

func TestKernelDurationSkipsInvertedWindow(t *testing.T) {
	fanout, reader, cleanup := newTestSpanFanout(t)
	defer cleanup()

	launch := &gpuebpf.KernelLaunchEvent{KernelName: "late"}
	launch.PID = 1
	launch.TID = 1
	launch.StreamID = 1
	launch.KtimeNs = 2_000_000_000
	fanout.HandleEvent(launch)

	sync := &gpuebpf.SyncEvent{}
	sync.PID = 1
	sync.TID = 1
	sync.StreamID = 1
	sync.KtimeNs = 1_000_000_000
	fanout.HandleEvent(sync)

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatal(err)
	}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != "gpu.kernel.duration" {
				continue
			}
			hist := m.Data.(metricdata.Histogram[float64])
			for _, dp := range hist.DataPoints {
				if dp.Count != 0 {
					t.Fatalf("expected no samples for inverted window, count=%d", dp.Count)
				}
			}
		}
	}
}

func TestKernelDurationCardinalityCap(t *testing.T) {
	em := &EBPFMetrics{
		kernelNames: make(map[string]struct{}),
	}
	for i := 0; i < maxKernelDurationNames; i++ {
		name := em.durationKernelName(fmt.Sprintf("kernel_%d", i))
		if name == "other" {
			t.Fatalf("premature other at %d", i)
		}
	}
	if got := em.durationKernelName("overflow"); got != "other" {
		t.Fatalf("got %q, want other", got)
	}
	if got := em.durationKernelName("kernel_0"); got != "kernel_0" {
		t.Fatalf("got %q", got)
	}
}

func TestProcessGPUMemoryUtilizationRatio(t *testing.T) {
	if got, ok := processGPUMemoryUtilization(50, 100); !ok || got != 0.5 {
		t.Fatalf("got %v ok=%v", got, ok)
	}
	if got, ok := processGPUMemoryUtilization(200, 100); !ok || got != 1 {
		t.Fatalf("clamp got %v ok=%v", got, ok)
	}
	if _, ok := processGPUMemoryUtilization(10, 0); ok {
		t.Fatal("limit 0 should omit")
	}
	if _, ok := processGPUMemoryUtilization(-1, 100); ok {
		t.Fatal("negative usage should omit")
	}
}
