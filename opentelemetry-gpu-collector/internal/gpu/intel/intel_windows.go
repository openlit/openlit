//go:build windows

package intel

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/windxg"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/winpdh"
)

// Device implements gpu.Device for Intel GPUs on Windows via DXGI + PDH.
// IGCL is not linked (cgo-free); thermals/power omitted when unavailable.
type Device struct {
	info    gpu.DeviceInfo
	adapter windxg.Adapter
	luidKey string
	logger  *slog.Logger
}

// DiscoverDevices discovers Intel adapters via DXGI.
func DiscoverDevices(pciAddresses []string, startIndex int, logger *slog.Logger) ([]*Device, error) {
	adapters, err := windxg.EnumAdapters()
	if err != nil {
		return nil, err
	}
	var devices []*Device
	idx := startIndex
	for _, a := range adapters {
		if a.VendorID != windxg.VendorIntel {
			continue
		}
		lower := strings.ToLower(a.Name)
		if strings.Contains(lower, "microsoft") || strings.Contains(lower, "basic") {
			continue
		}
		uuid := a.LUIDKey
		pci := fmt.Sprintf("dxgi:%04X:%04X", a.VendorID, a.DeviceID)
		logger.Info("discovered Intel GPU", "name", a.Name, "luid", a.LUIDKey)
		devices = append(devices, &Device{
			info: gpu.DeviceInfo{
				Vendor:     gpu.VendorIntel,
				Index:      idx,
				Name:       a.Name,
				UUID:       uuid,
				PCIAddress: pci,
			},
			adapter: a,
			luidKey: a.LUIDKey,
			logger:  logger.With("gpu", idx, "vendor", "intel"),
		})
		idx++
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
	return s, nil
}

func (d *Device) CollectProcesses() ([]gpu.ProcessUsage, error) {
	return winpdh.CollectForLUID(d.luidKey)
}

func (d *Device) Close() {}
