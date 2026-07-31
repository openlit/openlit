package export

import (
	"testing"

	gpuebpf "github.com/openlit/openlit/opentelemetry-gpu-collector/internal/ebpf"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

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

func TestCUDADeviceTrackerSoleGPU(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0, Name: "A100"}},
	}
	tr := newCUDADeviceTracker(devs)
	attrs := tr.deviceAttrs(1, 2)
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
}

func TestCUDADeviceTrackerMultiGPUNeedsSetDevice(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0, Name: "A100"}},
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-b", Index: 1, Name: "A100"}},
	}
	tr := newCUDADeviceTracker(devs)
	if attrs := tr.deviceAttrs(1, 2); len(attrs) != 0 {
		t.Fatalf("expected no attrs before SetDevice, got %#v", attrs)
	}
	tr.noteSetDevice(1, 2, 1)
	attrs := tr.deviceAttrs(1, 2)
	m := map[string]string{}
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

func TestCUDADeviceTrackerIgnoresUnknownIndex(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0}},
	}
	tr := newCUDADeviceTracker(devs)
	tr.noteSetDevice(1, 2, 9) // unknown CUDA index — ignored
	attrs := tr.deviceAttrs(1, 2)
	if len(attrs) == 0 {
		t.Fatal("sole GPU should still attribute")
	}
}

func TestCUDADeviceTrackerBoundsThreadMap(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0}},
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-b", Index: 1}},
	}
	tr := newCUDADeviceTracker(devs)
	// Force eviction path without allocating 8k entries in the test by
	// temporarily shrinking via filling past the cap with a local override.
	// We call noteSetDevice enough times that len exceeds threadDevMaxSize after
	// pre-seeding — use a smaller loop by filling the map directly then noting.
	for i := 0; i < threadDevMaxSize; i++ {
		tr.threadDev[uint64(i)] = 0
	}
	tr.noteSetDevice(42, 7, 1)
	if len(tr.threadDev) > threadDevMaxSize {
		t.Fatalf("threadDev grew unbounded: %d", len(tr.threadDev))
	}
	attrs := tr.deviceAttrs(42, 7)
	m := map[string]string{}
	for _, a := range attrs {
		m[string(a.Key)] = a.Value.Emit()
	}
	if m["hw.id"] != "gpu-b" {
		t.Fatalf("after eviction, latest SetDevice should stick; hw.id=%q", m["hw.id"])
	}
}
