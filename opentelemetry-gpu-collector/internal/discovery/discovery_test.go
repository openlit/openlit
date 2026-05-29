package discovery

import (
	"testing"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

func TestIsGPUClass(t *testing.T) {
	tests := []struct {
		classCode string
		want      bool
	}{
		// VGA compatible controller
		{"0x030000", true},
		{"0x030001", true}, // sub-class variation
		// 3D controller (NVIDIA Tesla / datacenter)
		{"0x030200", true},
		{"0x030201", true},
		// Display controller
		{"0x038000", true},
		{"0x038001", true},
		// Non-GPU classes
		{"0x020000", false}, // Ethernet
		{"0x010000", false}, // SCSI controller
		{"0x060000", false}, // Host bridge
		// Too short
		{"0x030", false},
		{"", false},
		// Case insensitive
		{"0X030000", true},
		{"0X030200", true},
		{"0X038000", true},
	}

	for _, tt := range tests {
		got := isGPUClass(tt.classCode)
		if got != tt.want {
			t.Errorf("isGPUClass(%q) = %v, want %v", tt.classCode, got, tt.want)
		}
	}
}

func TestMapVendor(t *testing.T) {
	tests := []struct {
		vendorID string
		want     gpu.Vendor
	}{
		{"0x10de", gpu.VendorNVIDIA},
		{"0x10DE", gpu.VendorNVIDIA}, // uppercase
		{"0x1002", gpu.VendorAMD},
		{"0x1002", gpu.VendorAMD},
		{"0x8086", gpu.VendorIntel},
		{"0x8086", gpu.VendorIntel},
		{"0x1234", gpu.VendorUnknown},
		{"", gpu.VendorUnknown},
		{"unknown", gpu.VendorUnknown},
	}

	for _, tt := range tests {
		got := mapVendor(tt.vendorID)
		if got != tt.want {
			t.Errorf("mapVendor(%q) = %q, want %q", tt.vendorID, got, tt.want)
		}
	}
}
