//go:build linux

package nvidia

import (
	"fmt"
	"log/slog"
	"sync"

	"github.com/NVIDIA/go-nvml/pkg/nvml"
	"github.com/openlit/openlit/openlit-collector/internal/gpu"
)

var (
	initOnce sync.Once
	initErr  error
)

// InitNVML initializes the NVML library. Safe to call multiple times.
func InitNVML() error {
	initOnce.Do(func() {
		ret := nvml.Init()
		if ret != nvml.SUCCESS {
			initErr = fmt.Errorf("nvml.Init: %s", nvml.ErrorString(ret))
		}
	})
	return initErr
}

// ShutdownNVML shuts down the NVML library.
func ShutdownNVML() {
	nvml.Shutdown()
}

// Device implements gpu.Device for NVIDIA GPUs via NVML.
type Device struct {
	handle nvml.Device
	info   gpu.DeviceInfo
	logger *slog.Logger
}

// DiscoverDevices returns all NVIDIA GPUs detected by NVML.
func DiscoverDevices(logger *slog.Logger) ([]*Device, error) {
	if err := InitNVML(); err != nil {
		return nil, err
	}

	count, ret := nvml.DeviceGetCount()
	if ret != nvml.SUCCESS {
		return nil, fmt.Errorf("DeviceGetCount: %s", nvml.ErrorString(ret))
	}

	driverVersion, ret := nvml.SystemGetDriverVersion()
	if ret != nvml.SUCCESS {
		driverVersion = "unknown"
	}

	devices := make([]*Device, 0, count)
	for i := 0; i < count; i++ {
		handle, ret := nvml.DeviceGetHandleByIndex(i)
		if ret != nvml.SUCCESS {
			logger.Warn("skipping NVIDIA GPU", "index", i, "error", nvml.ErrorString(ret))
			continue
		}

		name, _ := handle.GetName()
		uuid, _ := handle.GetUUID()
		pciInfo, _ := handle.GetPciInfo()

		devices = append(devices, &Device{
			handle: handle,
			info: gpu.DeviceInfo{
				Vendor:        gpu.VendorNVIDIA,
				Index:         i,
				Name:          name,
				UUID:          uuid,
				PCIAddress:    pciAddressString(pciInfo),
				DriverVersion: driverVersion,
			},
			logger: logger.With("gpu", i, "vendor", "nvidia"),
		})
	}

	return devices, nil
}

func (d *Device) Info() gpu.DeviceInfo {
	return d.info
}

func (d *Device) Collect() (*gpu.Snapshot, error) {
	s := &gpu.Snapshot{}

	if util, ret := d.handle.GetUtilizationRates(); ret == nvml.SUCCESS {
		gpuUtil := float64(util.Gpu)
		memUtil := float64(util.Memory)
		s.Utilization = &gpuUtil
		s.MemoryUtilization = &memUtil
	}

	if encUtil, _, ret := d.handle.GetEncoderUtilization(); ret == nvml.SUCCESS {
		v := float64(encUtil)
		s.EncoderUtilization = &v
	}

	if decUtil, _, ret := d.handle.GetDecoderUtilization(); ret == nvml.SUCCESS {
		v := float64(decUtil)
		s.DecoderUtilization = &v
	}

	if temp, ret := d.handle.GetTemperature(nvml.TEMPERATURE_GPU); ret == nvml.SUCCESS {
		v := float64(temp)
		s.TemperatureGPU = &v
	}

	if fanSpeed, ret := d.handle.GetFanSpeed(); ret == nvml.SUCCESS {
		v := float64(fanSpeed)
		s.FanSpeedRPM = &v
	}

	if mem, ret := d.handle.GetMemoryInfo(); ret == nvml.SUCCESS {
		total := int64(mem.Total)
		used := int64(mem.Used)
		free := int64(mem.Free)
		s.MemoryTotalBytes = &total
		s.MemoryUsedBytes = &used
		s.MemoryFreeBytes = &free
	}

	// NVML returns power in milliwatts
	if power, ret := d.handle.GetPowerUsage(); ret == nvml.SUCCESS {
		v := float64(power) / 1000.0
		s.PowerDrawWatts = &v
	}

	if limit, ret := d.handle.GetPowerManagementLimit(); ret == nvml.SUCCESS {
		v := float64(limit) / 1000.0
		s.PowerLimitWatts = &v
	}

	// NVML returns energy in millijoules
	if energy, ret := d.handle.GetTotalEnergyConsumption(); ret == nvml.SUCCESS {
		v := float64(energy) / 1000.0
		s.EnergyJoules = &v
	}

	if clock, ret := d.handle.GetClockInfo(nvml.CLOCK_GRAPHICS); ret == nvml.SUCCESS {
		v := float64(clock)
		s.ClockGraphicsMHz = &v
	}

	if clock, ret := d.handle.GetClockInfo(nvml.CLOCK_MEM); ret == nvml.SUCCESS {
		v := float64(clock)
		s.ClockMemoryMHz = &v
	}

	if replay, ret := d.handle.GetPcieReplayCounter(); ret == nvml.SUCCESS {
		v := int64(replay)
		s.PCIeReplayErrors = &v
	}

	if ecc, ret := d.handle.GetTotalEccErrors(nvml.MEMORY_ERROR_TYPE_CORRECTED, nvml.VOLATILE_ECC); ret == nvml.SUCCESS {
		v := int64(ecc)
		s.ECCSingleBit = &v
	}

	if ecc, ret := d.handle.GetTotalEccErrors(nvml.MEMORY_ERROR_TYPE_UNCORRECTED, nvml.VOLATILE_ECC); ret == nvml.SUCCESS {
		v := int64(ecc)
		s.ECCDoubleBit = &v
	}

	return s, nil
}

func (d *Device) Close() {}

func pciAddressString(pci nvml.PciInfo) string {
	// PciInfo.BusId is a fixed-size byte array; convert to string.
	var buf []byte
	for _, b := range pci.BusId {
		if b == 0 {
			break
		}
		buf = append(buf, byte(b))
	}
	if len(buf) > 0 {
		return string(buf)
	}
	return fmt.Sprintf("%04x:%02x:%02x.0", pci.Domain, pci.Bus, pci.Device)
}
