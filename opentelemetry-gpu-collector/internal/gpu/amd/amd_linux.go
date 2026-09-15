//go:build linux

package amd

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/amdsmi"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/drmfdinfo"
)

const (
	drmClassPath   = "/sys/class/drm"
	hwmonClassPath = "/sys/class/hwmon"
)

// Device implements gpu.Device for AMD GPUs via sysfs/hwmon.
type Device struct {
	info        gpu.DeviceInfo
	drmPath     string // e.g. /sys/class/drm/card0/device
	hwmonPath   string // e.g. /sys/class/hwmon/hwmon3
	vendorIndex int    // 0-based among AMD devices (for amdsmi)
	logger      *slog.Logger
}

// DiscoverDevices scans sysfs for AMD GPU DRM cards and resolves their hwmon paths.
// When pciAddresses is empty, all amdgpu DRM cards are discovered (PCI-less fallback).
func DiscoverDevices(pciAddresses []string, startIndex int, logger *slog.Logger) ([]*Device, error) {
	addrSet := make(map[string]bool, len(pciAddresses))
	filter := len(pciAddresses) > 0
	for _, a := range pciAddresses {
		addrSet[strings.ToLower(a)] = true
	}

	entries, err := os.ReadDir(drmClassPath)
	if err != nil {
		return nil, fmt.Errorf("reading DRM class: %w", err)
	}

	var devices []*Device
	idx := startIndex
	vendorIdx := 0

	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "card") || strings.Contains(name, "-") {
			continue
		}

		devPath := filepath.Join(drmClassPath, name, "device")
		uevent := readFileString(filepath.Join(devPath, "uevent"))
		pciAddr := extractUeventValue(uevent, "PCI_SLOT_NAME")
		if pciAddr == "" {
			continue
		}

		if filter && !addrSet[strings.ToLower(pciAddr)] {
			continue
		}

		driverLink, err := os.Readlink(filepath.Join(devPath, "driver"))
		if err != nil || filepath.Base(driverLink) != "amdgpu" {
			continue
		}

		hwmon := findHwmonForDevice(devPath)

		productName := readFileString(filepath.Join(devPath, "product_name"))
		if productName == "" {
			productName = fmt.Sprintf("AMD GPU %s", pciAddr)
		}

		uniqueID := readFileString(filepath.Join(devPath, "unique_id"))
		if uniqueID == "" {
			uniqueID = pciAddr
		}

		driverVersion := readFileString(filepath.Join(devPath, "driver", "module", "version"))

		logger.Info("discovered AMD GPU", "card", name, "pci", pciAddr, "hwmon", hwmon)

		devices = append(devices, &Device{
			info: gpu.DeviceInfo{
				Vendor:        gpu.VendorAMD,
				Index:         idx,
				Name:          productName,
				UUID:          uniqueID,
				PCIAddress:    pciAddr,
				DriverVersion: driverVersion,
			},
			drmPath:     devPath,
			hwmonPath:   hwmon,
			vendorIndex: vendorIdx,
			logger:      logger.With("gpu", idx, "vendor", "amd"),
		})
		idx++
		vendorIdx++
	}

	return devices, nil
}

func (d *Device) Info() gpu.DeviceInfo {
	return d.info
}

func (d *Device) Collect() (*gpu.Snapshot, error) {
	s := &gpu.Snapshot{}

	if v, err := readSysfsInt(filepath.Join(d.drmPath, "gpu_busy_percent")); err == nil {
		f := float64(v)
		s.Utilization = &f
	}

	if v, err := readSysfsInt(filepath.Join(d.drmPath, "mem_busy_percent")); err == nil {
		f := float64(v)
		s.MemoryUtilization = &f
	}

	if v, err := readSysfsInt(filepath.Join(d.drmPath, "mem_info_vram_total")); err == nil {
		s.MemoryTotalBytes = &v
	}
	if v, err := readSysfsInt(filepath.Join(d.drmPath, "mem_info_vram_used")); err == nil {
		s.MemoryUsedBytes = &v
	}
	if s.MemoryTotalBytes != nil && s.MemoryUsedBytes != nil {
		free := *s.MemoryTotalBytes - *s.MemoryUsedBytes
		if free < 0 {
			free = 0
		}
		s.MemoryFreeBytes = &free
	}

	if d.hwmonPath != "" {
		d.collectHwmon(s)
	}

	if m, ok := amdsmi.Collect(d.vendorIndex); ok {
		if m.Utilization != nil && s.Utilization == nil {
			s.Utilization = m.Utilization
		}
		if m.PowerWatts != nil && s.PowerDrawWatts == nil {
			s.PowerDrawWatts = m.PowerWatts
		}
		if m.TemperatureC != nil && s.TemperatureGPU == nil {
			s.TemperatureGPU = m.TemperatureC
		}
		if m.MemoryTotal != nil && s.MemoryTotalBytes == nil {
			s.MemoryTotalBytes = m.MemoryTotal
		}
		if m.MemoryUsed != nil && s.MemoryUsedBytes == nil {
			s.MemoryUsedBytes = m.MemoryUsed
		}
		if m.PCIeRxBytesPerSec != nil {
			s.PCIeRxBytesPerSec = m.PCIeRxBytesPerSec
		}
		if m.PCIeTxBytesPerSec != nil {
			s.PCIeTxBytesPerSec = m.PCIeTxBytesPerSec
		}
		if m.PCIeReplayErrors != nil {
			s.PCIeReplayErrors = m.PCIeReplayErrors
		}
		if m.InterconnectRxBytesPerSec != nil {
			s.InterconnectRxBytesPerSec = m.InterconnectRxBytesPerSec
			s.InterconnectType = "xgmi"
		}
		if m.InterconnectTxBytesPerSec != nil {
			s.InterconnectTxBytesPerSec = m.InterconnectTxBytesPerSec
			s.InterconnectType = "xgmi"
		}
		if m.ThrottleReasons != nil {
			s.ThrottleReasons = m.ThrottleReasons
		}
		if m.Throttled != nil {
			s.Throttled = m.Throttled
		}
		if m.EncoderUtilization != nil {
			s.EncoderUtilization = m.EncoderUtilization
		}
	}
	if ce, ue := amdsmi.CollectRAS(d.drmPath); ce != nil || ue != nil {
		s.RASCE = ce
		s.RASUE = ue
	}

	return s, nil
}

func (d *Device) collectHwmon(s *gpu.Snapshot) {
	// Temperature: temp1_input is GPU edge temp in millidegrees C
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "temp1_input")); err == nil {
		f := float64(v) / 1000.0
		s.TemperatureGPU = &f
	}
	// temp2_input is junction/memory temp on SOC15+ dGPUs
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "temp2_input")); err == nil {
		f := float64(v) / 1000.0
		s.TemperatureMemory = &f
	}

	// Power: power1_average in microwatts
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "power1_average")); err == nil {
		f := float64(v) / 1e6
		s.PowerDrawWatts = &f
	}

	// Power cap: power1_cap in microwatts
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "power1_cap")); err == nil {
		f := float64(v) / 1e6
		s.PowerLimitWatts = &f
	}

	// Energy: energy1_input in microjoules
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "energy1_input")); err == nil {
		f := float64(v) / 1e6
		s.EnergyJoules = &f
	}

	// Graphics clock: freq1_input in Hz
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "freq1_input")); err == nil {
		f := float64(v) / 1e6 // Hz to MHz
		s.ClockGraphicsMHz = &f
	}

	// Memory clock: freq2_input in Hz (dGPU only)
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "freq2_input")); err == nil {
		f := float64(v) / 1e6
		s.ClockMemoryMHz = &f
	}

	// Fan speed: fan1_input in RPM
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "fan1_input")); err == nil {
		f := float64(v)
		s.FanSpeedRPM = &f
	}
}

func (d *Device) Close() {}

func (d *Device) CollectProcesses() ([]gpu.ProcessUsage, error) {
	return drmfdinfo.Shared().CollectForPCI(d.info.PCIAddress, map[string]bool{"amdgpu": true})
}

// findHwmonForDevice locates the hwmon directory associated with a DRM device path.
func findHwmonForDevice(drmDevicePath string) string {
	hwmonDir := filepath.Join(drmDevicePath, "hwmon")
	entries, err := os.ReadDir(hwmonDir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "hwmon") {
			return filepath.Join(hwmonDir, e.Name())
		}
	}
	return ""
}

func readFileString(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func readSysfsInt(path string) (int64, error) {
	s := readFileString(path)
	if s == "" {
		return 0, fmt.Errorf("empty or missing: %s", path)
	}
	return strconv.ParseInt(s, 10, 64)
}

func extractUeventValue(uevent, key string) string {
	for _, line := range strings.Split(uevent, "\n") {
		if strings.HasPrefix(line, key+"=") {
			return strings.TrimPrefix(line, key+"=")
		}
	}
	return ""
}
