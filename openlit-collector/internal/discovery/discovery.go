package discovery

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/openlit/openlit/openlit-collector/internal/gpu"
)

const pciDevicesPath = "/sys/bus/pci/devices"

// PCI vendor IDs for GPU manufacturers.
const (
	pciVendorNVIDIA = "0x10de"
	pciVendorAMD    = "0x1002"
	pciVendorIntel  = "0x8086"
)

// PCI class codes for display/VGA/3D controllers.
var gpuClassPrefixes = []string{
	"0x0300", // VGA compatible controller
	"0x0302", // 3D controller (e.g. NVIDIA Tesla/datacenter)
	"0x0380", // Display controller
}

// PCIDevice holds the PCI-level information needed to instantiate a GPU backend.
type PCIDevice struct {
	Address string
	Vendor  gpu.Vendor
}

// Discover scans the PCI bus and returns all detected GPU devices.
func Discover(logger *slog.Logger) ([]PCIDevice, error) {
	entries, err := os.ReadDir(pciDevicesPath)
	if err != nil {
		return nil, fmt.Errorf("reading PCI devices: %w", err)
	}

	var devices []PCIDevice
	for _, entry := range entries {
		addr := entry.Name()
		devPath := filepath.Join(pciDevicesPath, addr)

		classCode := readSysfsString(filepath.Join(devPath, "class"))
		if !isGPUClass(classCode) {
			continue
		}

		vendorID := readSysfsString(filepath.Join(devPath, "vendor"))
		vendor := mapVendor(vendorID)
		if vendor == gpu.VendorUnknown {
			logger.Debug("skipping unknown GPU vendor", "address", addr, "vendor_id", vendorID)
			continue
		}

		logger.Info("discovered GPU", "address", addr, "vendor", vendor)
		devices = append(devices, PCIDevice{
			Address: addr,
			Vendor:  vendor,
		})
	}

	return devices, nil
}

func readSysfsString(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func isGPUClass(classCode string) bool {
	// PCI class is 24 bits; the file contains e.g. "0x030000".
	// We match on the first 6 hex chars (base class + sub class).
	if len(classCode) < 6 {
		return false
	}
	prefix := classCode[:6]
	for _, gp := range gpuClassPrefixes {
		if strings.EqualFold(prefix, gp) {
			return true
		}
	}
	return false
}

func mapVendor(vendorID string) gpu.Vendor {
	switch strings.ToLower(vendorID) {
	case pciVendorNVIDIA:
		return gpu.VendorNVIDIA
	case pciVendorAMD:
		return gpu.VendorAMD
	case pciVendorIntel:
		return gpu.VendorIntel
	default:
		return gpu.VendorUnknown
	}
}
