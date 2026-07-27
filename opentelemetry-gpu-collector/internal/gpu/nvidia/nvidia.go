//go:build linux && (amd64 || arm64) && cgo

package nvidia

import (
	"fmt"
	"log/slog"
	"sync"

	"github.com/NVIDIA/go-nvml/pkg/nvml"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/procname"
)

var (
	initMu   sync.Mutex
	initDone bool
	initErr  error
)

// InitNVML initializes the NVML library. Safe to call multiple times.
// Failed inits are retried on later calls so a transient driver miss during
// early DaemonSet start does not permanently disable discovery.
func InitNVML() error {
	initMu.Lock()
	defer initMu.Unlock()
	if initDone && initErr == nil {
		return nil
	}
	ret := nvml.Init()
	if ret != nvml.SUCCESS {
		initDone = false
		initErr = fmt.Errorf("nvml.Init: %s", nvml.ErrorString(ret))
		return initErr
	}
	initDone = true
	initErr = nil
	return nil
}

// ShutdownNVML shuts down the NVML library.
func ShutdownNVML() {
	initMu.Lock()
	defer initMu.Unlock()
	if initDone {
		nvml.Shutdown()
	}
	initDone = false
	initErr = nil
}

// Device implements gpu.Device for NVIDIA GPUs via NVML.
type Device struct {
	handle              nvml.Device
	info                gpu.DeviceInfo
	logger              *slog.Logger
	lastUtilTimestamp   uint64
	migMemoryOnlyLogged bool
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
		coreCount := 0
		if cores, ret := handle.GetNumGpuCores(); ret == nvml.SUCCESS {
			coreCount = cores
		}

		devices = append(devices, &Device{
			handle: handle,
			info: gpu.DeviceInfo{
				Vendor:        gpu.VendorNVIDIA,
				Index:         i,
				Name:          name,
				UUID:          uuid,
				PCIAddress:    pciAddressString(pciInfo),
				DriverVersion: driverVersion,
				CoreCount:     coreCount,
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

	// NVML GetFanSpeed is percent (0–100), not RPM — omit FanSpeedRPM (AMD/Intel use hwmon RPM).

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

func (d *Device) CollectProcesses() ([]gpu.ProcessUsage, error) {
	procs, ret := d.handle.GetComputeRunningProcesses()
	if ret != nvml.SUCCESS {
		// MIG / unsupported — try empty rather than fail the scrape
		d.logger.Debug("GetComputeRunningProcesses unavailable", "error", nvml.ErrorString(ret))
		return nil, nil
	}

	byPID := make(map[uint32]*gpu.ProcessUsage, len(procs))
	for _, p := range procs {
		mem := int64(p.UsedGpuMemory)
		pu := &gpu.ProcessUsage{
			PID:            int32(p.Pid),
			ExecutableName: procname.ExecutableName(int32(p.Pid)),
			MemoryBytes:    &mem,
		}
		byPID[p.Pid] = pu
	}

	samples, ret := d.handle.GetProcessUtilization(d.lastUtilTimestamp)
	if ret == nvml.SUCCESS {
		var maxTS uint64
		for _, s := range samples {
			if s.TimeStamp > maxTS {
				maxTS = s.TimeStamp
			}
			pu := byPID[s.Pid]
			if pu == nil {
				pu = &gpu.ProcessUsage{
					PID:            int32(s.Pid),
					ExecutableName: procname.ExecutableName(int32(s.Pid)),
				}
				byPID[s.Pid] = pu
			}
			// NVML reports percent 0–100
			sm := float64(s.SmUtil) / 100.0
			pu.Utilization = &sm
			if s.EncUtil > 0 || pu.EncoderUtil == nil {
				enc := float64(s.EncUtil) / 100.0
				pu.EncoderUtil = &enc
			}
			if s.DecUtil > 0 || pu.DecoderUtil == nil {
				dec := float64(s.DecUtil) / 100.0
				pu.DecoderUtil = &dec
			}
		}
		if maxTS > 0 {
			d.lastUtilTimestamp = maxTS
		}
	} else if len(byPID) > 0 && !d.migMemoryOnlyLogged {
		// Common on MIG: memory list works, util samples do not.
		d.logger.Debug("GetProcessUtilization unavailable; emitting memory-only process metrics",
			"error", nvml.ErrorString(ret))
		d.migMemoryOnlyLogged = true
	}

	out := make([]gpu.ProcessUsage, 0, len(byPID))
	for _, pu := range byPID {
		out = append(out, *pu)
	}
	return out, nil
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
