package export

import (
	"testing"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/cudaspans"
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

func TestDeviceAttrsSoleGPU(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0, Name: "A100", PCIAddress: "0000:01:00.0"}},
	}
	em := &EBPFMetrics{devices: cudaspans.NewDeviceResolver(devs)}
	attrs := em.deviceAttrs(1, 2)
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

func TestDeviceAttrsMultiGPUNeedsSetDevice(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0, Name: "A100"}},
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-b", Index: 1, Name: "A100"}},
	}
	em := &EBPFMetrics{devices: cudaspans.NewDeviceResolver(devs)}
	if attrs := em.deviceAttrs(1, 2); len(attrs) != 0 {
		t.Fatalf("expected no attrs before SetDevice, got %#v", attrs)
	}
	em.devices.NoteSetDevice(1, 2, 1)
	attrs := em.deviceAttrs(1, 2)
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

func TestDeviceAttrsIgnoresUnknownIndex(t *testing.T) {
	devs := []gpu.Device{
		&mockDevice{info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "gpu-a", Index: 0}},
	}
	em := &EBPFMetrics{devices: cudaspans.NewDeviceResolver(devs)}
	em.devices.NoteSetDevice(1, 2, 9) // unknown CUDA index — ignored
	attrs := em.deviceAttrs(1, 2)
	if len(attrs) == 0 {
		t.Fatal("sole GPU should still attribute")
	}
}
