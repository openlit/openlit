package export

import (
	"testing"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

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
