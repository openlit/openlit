package export

import (
	"context"
	"os"
	"testing"

	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/cudaspans"
	gpuebpf "github.com/openlit/openlit/opentelemetry-gpu-collector/internal/ebpf"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

func TestGraphLaunchDoesNotIncrementKernelCalls(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer func() { _ = provider.Shutdown(context.Background()) }()

	em, err := NewEBPFMetrics(provider, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer em.Close()

	kernel := &gpuebpf.KernelLaunchEvent{KernelName: "vector_add", GridX: 2, GridY: 1, GridZ: 1, BlockX: 32, BlockY: 1, BlockZ: 1}
	kernel.PID = uint32(os.Getpid())
	kernel.TID = 43
	em.HandleEvent(kernel)

	graph := &gpuebpf.GraphLaunchEvent{}
	graph.PID = uint32(os.Getpid())
	graph.TID = 43
	em.HandleEvent(graph)

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatal(err)
	}

	kernelCalls := sumInt64Counter(t, rm, "gpu.kernel.launch.calls")
	graphCalls := sumInt64Counter(t, rm, "gpu.graph.launch.calls")
	if kernelCalls != 1 {
		t.Fatalf("gpu.kernel.launch.calls = %d, want 1", kernelCalls)
	}
	if graphCalls != 1 {
		t.Fatalf("gpu.graph.launch.calls = %d, want 1", graphCalls)
	}
}

func sumInt64Counter(t *testing.T, rm metricdata.ResourceMetrics, name string) int64 {
	t.Helper()
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != name {
				continue
			}
			sum, ok := m.Data.(metricdata.Sum[int64])
			if !ok {
				t.Fatalf("%s: unexpected data type %T", name, m.Data)
			}
			var total int64
			for _, dp := range sum.DataPoints {
				total += dp.Value
			}
			return total
		}
	}
	t.Fatalf("metric %q not found", name)
	return 0
}

func TestKernelMetricNameUsesStableFallback(t *testing.T) {
	event := &gpuebpf.KernelLaunchEvent{KernelAddr: 0x7fff12345678}
	if got := kernelMetricName(event); got != "unknown" {
		t.Fatalf("kernelMetricName() = %q, want unknown", got)
	}
	event.KernelName = "vector_add"
	if got := kernelMetricName(event); got != "vector_add" {
		t.Fatalf("kernelMetricName() = %q, want vector_add", got)
	}
}

func TestDeviceAttrsSoleGPU(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0, Name: "A100", PCIAddress: "0000:01:00.0"}},
	}
	em := &EBPFMetrics{devices: cudaspans.NewDeviceResolver(devs)}
	attrs := em.deviceAttrs(1, 2, -1, "")
	if len(attrs) < 2 {
		t.Fatalf("expected sole-GPU attrs, got %#v", attrs)
	}
	m := map[string]string{}
	for _, a := range attrs {
		m[string(a.Key)] = a.Value.Emit()
	}
	if m["hw.id"] != "gpu-a" {
		t.Fatalf("hw.id = %q", m["hw.id"])
	}
	if m["hw.type"] != "gpu" {
		t.Fatalf("hw.type = %q", m["hw.type"])
	}
	if m["gpu.pci_address"] != "0000:01:00.0" {
		t.Fatalf("pci = %q", m["gpu.pci_address"])
	}
}

func TestDeviceAttrsMultiGPUDefaultsToCUDAZero(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0, Name: "A100"}},
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-b", Index: 1, Name: "A100"}},
	}
	em := &EBPFMetrics{devices: cudaspans.NewDeviceResolver(devs)}
	attrs := em.deviceAttrs(1, 2, -1, "")
	m := map[string]string{}
	for _, a := range attrs {
		m[string(a.Key)] = a.Value.Emit()
	}
	if m["hw.id"] != "gpu-a" {
		t.Fatalf("hw.id = %q, want gpu-a (CUDA default device 0)", m["hw.id"])
	}
	em.devices.NoteSetDevice(1, 2, 1)
	attrs = em.deviceAttrs(1, 2, -1, "")
	m = map[string]string{}
	for _, a := range attrs {
		m[string(a.Key)] = a.Value.Emit()
	}
	if m["hw.id"] != "gpu-b" {
		t.Fatalf("hw.id = %q, want gpu-b", m["hw.id"])
	}
	if m["gpu.index"] != "1" {
		t.Fatalf("gpu.index = %q, want 1", m["gpu.index"])
	}
}

func TestDeadPIDCountersStopExporting(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer func() { _ = provider.Shutdown(context.Background()) }()

	em, err := NewEBPFMetrics(provider, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer em.Close()
	em.pidAlive = func(pid uint32) bool { return pid == 1 }

	live := &gpuebpf.KernelLaunchEvent{KernelName: "live"}
	live.PID = 1
	em.HandleEvent(live)
	dead := &gpuebpf.KernelLaunchEvent{KernelName: "dead"}
	dead.PID = 2
	em.HandleEvent(dead)

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatal(err)
	}
	var pids []string
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != "gpu.kernel.launch.calls" {
				continue
			}
			sum := m.Data.(metricdata.Sum[int64])
			for _, dp := range sum.DataPoints {
				v, _ := dp.Attributes.Value("process.pid")
				pids = append(pids, v.AsString())
			}
		}
	}
	if len(pids) != 1 || pids[0] != "1" {
		t.Fatalf("exported pids = %v, want [1]", pids)
	}
	if n := sumInt64Counter(t, rm, "gpu.kernel.launch.calls"); n != 1 {
		t.Fatalf("calls = %d, want 1", n)
	}
}

func TestDeviceAttrsPrefersEventDeviceIndex(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0, Name: "A100"}},
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-b", Index: 1, Name: "A100"}},
	}
	em := &EBPFMetrics{devices: cudaspans.NewDeviceResolver(devs)}
	attrs := em.deviceAttrs(1, 2, 1, "")
	m := map[string]string{}
	for _, a := range attrs {
		m[string(a.Key)] = a.Value.Emit()
	}
	if m["hw.id"] != "gpu-b" {
		t.Fatalf("hw.id = %q, want gpu-b from event DeviceIdx", m["hw.id"])
	}
}

func TestDeviceAttrsPrefersSpanUUID(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0}},
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-b", Index: 1}},
	}
	em := &EBPFMetrics{devices: cudaspans.NewDeviceResolver(devs)}
	attrs := em.deviceAttrs(1, 2, 0, "gpu-b")
	m := map[string]string{}
	for _, a := range attrs {
		m[string(a.Key)] = a.Value.Emit()
	}
	if m["hw.id"] != "gpu-b" {
		t.Fatalf("hw.id = %q, want gpu-b from span UUID", m["hw.id"])
	}
}

func TestDeviceAttrsIgnoresUnknownIndex(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0}},
	}
	em := &EBPFMetrics{devices: cudaspans.NewDeviceResolver(devs)}
	em.devices.NoteSetDevice(1, 2, 9) // unknown CUDA index — ignored
	attrs := em.deviceAttrs(1, 2, -1, "")
	if len(attrs) == 0 {
		t.Fatal("sole GPU should still attribute")
	}
}

func TestLaunchCounterUsesEventDeviceIndex(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer func() { _ = provider.Shutdown(context.Background()) }()

	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0, Name: "A100"}},
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-b", Index: 1, Name: "A100"}},
	}
	em, err := NewEBPFMetrics(provider, cudaspans.NewDeviceResolver(devs), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer em.Close()

	kernel := &gpuebpf.KernelLaunchEvent{KernelName: "matmul"}
	kernel.PID = uint32(os.Getpid())
	kernel.DeviceIdx = 1
	em.HandleEvent(kernel)

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != "gpu.kernel.launch.calls" {
				continue
			}
			sum := m.Data.(metricdata.Sum[int64])
			for _, dp := range sum.DataPoints {
				id, _ := dp.Attributes.Value("hw.id")
				if id.AsString() != "gpu-b" {
					t.Fatalf("hw.id = %q, want gpu-b", id.AsString())
				}
				found = true
			}
		}
	}
	if !found {
		t.Fatal("gpu.kernel.launch.calls missing hw.id")
	}
}
