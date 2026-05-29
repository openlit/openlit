package intel

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

const (
	drmClassPath   = "/sys/class/drm"
	hwmonClassPath = "/sys/class/hwmon"
)

// Device implements gpu.Device for Intel GPUs via sysfs/hwmon/DRM.
type Device struct {
	info      gpu.DeviceInfo
	drmPath   string // e.g. /sys/class/drm/card0/device
	hwmonPath string
	logger    *slog.Logger
}

// DiscoverDevices scans sysfs for Intel GPU DRM cards driven by i915 or xe.
func DiscoverDevices(pciAddresses []string, startIndex int, logger *slog.Logger) ([]*Device, error) {
	if len(pciAddresses) == 0 {
		return nil, nil
	}

	addrSet := make(map[string]bool, len(pciAddresses))
	for _, a := range pciAddresses {
		addrSet[strings.ToLower(a)] = true
	}

	entries, err := os.ReadDir(drmClassPath)
	if err != nil {
		return nil, fmt.Errorf("reading DRM class: %w", err)
	}

	var devices []*Device
	idx := startIndex

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

		if !addrSet[strings.ToLower(pciAddr)] {
			continue
		}

		driverLink, err := os.Readlink(filepath.Join(devPath, "driver"))
		if err != nil {
			continue
		}
		driverName := filepath.Base(driverLink)
		if driverName != "i915" && driverName != "xe" {
			continue
		}

		hwmon := findHwmonForDevice(devPath)

		productName := readFileString(filepath.Join(devPath, "label"))
		if productName == "" {
			productName = fmt.Sprintf("Intel GPU %s", pciAddr)
		}

		logger.Info("discovered Intel GPU", "card", name, "pci", pciAddr, "driver", driverName, "hwmon", hwmon)

		devices = append(devices, &Device{
			info: gpu.DeviceInfo{
				Vendor:        gpu.VendorIntel,
				Index:         idx,
				Name:          productName,
				UUID:          pciAddr,
				PCIAddress:    pciAddr,
				DriverVersion: driverName,
			},
			drmPath:   devPath,
			hwmonPath: hwmon,
			logger:    logger.With("gpu", idx, "vendor", "intel"),
		})
		idx++
	}

	return devices, nil
}

func (d *Device) Info() gpu.DeviceInfo {
	return d.info
}

func (d *Device) Collect() (*gpu.Snapshot, error) {
	s := &gpu.Snapshot{}

	// Intel Xe driver exposes some metrics via DRM sysfs
	if v, err := readSysfsInt(filepath.Join(d.drmPath, "gt_cur_freq_mhz")); err == nil {
		f := float64(v)
		s.ClockGraphicsMHz = &f
	}

	if d.hwmonPath != "" {
		d.collectHwmon(s)
	}

	return s, nil
}

func (d *Device) collectHwmon(s *gpu.Snapshot) {
	// Temperature
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "temp1_input")); err == nil {
		f := float64(v) / 1000.0
		s.TemperatureGPU = &f
	}

	// Power: Xe hwmon exposes energy1_input (microjoules).
	// Compute average power from energy delta externally or report instantaneous if available.
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "power1_average")); err == nil {
		f := float64(v) / 1e6
		s.PowerDrawWatts = &f
	}

	// Power limit (Xe: power1_max in microwatts)
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "power1_max")); err == nil {
		f := float64(v) / 1e6
		s.PowerLimitWatts = &f
	}

	// Cumulative energy (microjoules)
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "energy1_input")); err == nil {
		f := float64(v) / 1e6
		s.EnergyJoules = &f
	}

	// Fan speed (Xe hwmon, Linux 6.16+)
	if v, err := readSysfsInt(filepath.Join(d.hwmonPath, "fan1_input")); err == nil {
		f := float64(v)
		s.FanSpeedRPM = &f
	}
}

func (d *Device) Close() {}

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
