//go:build windows

package amd

import (
	"fmt"
	"log/slog"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/adlx"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/windxg"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/winpdh"
)

// Device implements gpu.Device for AMD GPUs on Windows via DXGI + PDH + ADL.
type Device struct {
	info        gpu.DeviceInfo
	adapter     windxg.Adapter
	luidKey     string
	vendorIndex int // 0-based among AMD adapters (for ADL)
	logger      *slog.Logger
}

// DiscoverDevices discovers AMD adapters via DXGI.
// pciAddresses is ignored on Windows (DXGI enumeration replaces PCI sysfs).
func DiscoverDevices(pciAddresses []string, startIndex int, logger *slog.Logger) ([]*Device, error) {
	adapters, err := windxg.EnumAdapters()
	if err != nil {
		return nil, err
	}
	var devices []*Device
	idx := startIndex
	vendorIdx := 0
	for _, a := range adapters {
		if a.VendorID != windxg.VendorAMD {
			continue
		}
		uuid := a.LUIDKey
		pci := fmt.Sprintf("dxgi:%04X:%04X", a.VendorID, a.DeviceID)
		logger.Info("discovered AMD GPU", "name", a.Name, "luid", a.LUIDKey)
		devices = append(devices, &Device{
			info: gpu.DeviceInfo{
				Vendor:     gpu.VendorAMD,
				Index:      idx,
				Name:       a.Name,
				UUID:       uuid,
				PCIAddress: pci,
			},
			adapter:     a,
			luidKey:     a.LUIDKey,
			vendorIndex: vendorIdx,
			logger:      logger.With("gpu", idx, "vendor", "amd"),
		})
		idx++
		vendorIdx++
	}
	return devices, nil
}

func (d *Device) Info() gpu.DeviceInfo { return d.info }

func (d *Device) Collect() (*gpu.Snapshot, error) {
	s := &gpu.Snapshot{}
	total := int64(d.adapter.DedicatedVideoMemory)
	if total > 0 {
		s.MemoryTotalBytes = &total
	}
	if au, ok := winpdh.AdapterSnapshot(d.luidKey); ok {
		if au.HasUtil {
			u := au.Util * 100
			s.Utilization = &u
		}
		if au.HasEnc {
			e := au.EncoderUtil * 100
			s.EncoderUtilization = &e
		}
		if au.HasDec {
			dec := au.DecoderUtil * 100
			s.DecoderUtilization = &dec
		}
		if au.HasMemory {
			used := au.MemoryUsed
			s.MemoryUsedBytes = &used
			if total > 0 {
				free := total - used
				if free < 0 {
					free = 0
				}
				s.MemoryFreeBytes = &free
			}
		}
	}
	// Enrich with ADL using vendor-local index (not global gpu.index).
	if m, ok := adlx.Collect(d.vendorIndex); ok {
		if m.Utilization != nil {
			s.Utilization = m.Utilization
		}
		if m.TemperatureC != nil {
			s.TemperatureGPU = m.TemperatureC
		}
		if m.ClockMHz != nil {
			s.ClockGraphicsMHz = m.ClockMHz
		}
		if m.VRAMClockMHz != nil {
			s.ClockMemoryMHz = m.VRAMClockMHz
		}
		if m.FanRPM != nil {
			s.FanSpeedRPM = m.FanRPM
		}
		if m.PowerWatts != nil {
			s.PowerDrawWatts = m.PowerWatts
		}
	}
	return s, nil
}

func (d *Device) CollectProcesses() ([]gpu.ProcessUsage, error) {
	return winpdh.CollectForLUID(d.luidKey)
}

func (d *Device) Close() {}
