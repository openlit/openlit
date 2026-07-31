package export

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strconv"
	"sync"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/cudaoccupancy"
	gpuebpf "github.com/openlit/openlit/opentelemetry-gpu-collector/internal/ebpf"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/procname"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/workload"
)

// OccupancyMetrics exports Datadog-parity stream-sync occupancy gauges.
// These are model estimates (launch→sync), not hardware SM occupancy.
type OccupancyMetrics struct {
	logger *slog.Logger
	engine *cudaoccupancy.Engine
	reg    metric.Registration

	mu            sync.Mutex
	lastProcesses []cudaoccupancy.ProcessStats
	lastDevices   []cudaoccupancy.DeviceStats
	prevPIDs      map[string]struct{} // uuid|pid seen last flush — zero-on-leave
}

// NewOccupancyMetrics wires an occupancy engine to OTel observable gauges.
func NewOccupancyMetrics(
	provider *sdkmetric.MeterProvider,
	devices []gpu.Device,
	logger *slog.Logger,
) (*OccupancyMetrics, error) {
	cores := make(map[string]uint64)
	for _, d := range devices {
		info := d.Info()
		if info.Vendor != gpu.VendorNVIDIA {
			continue
		}
		if info.CoreCount > 0 {
			cores[info.UUID] = uint64(info.CoreCount)
		}
	}
	engine := cudaoccupancy.NewEngine(cores)
	for _, d := range devices {
		info := d.Info()
		if info.Vendor == gpu.VendorNVIDIA {
			engine.SetDeviceIndexUUID(info.Index, info.UUID)
		}
	}

	om := &OccupancyMetrics{
		logger:   logger,
		engine:   engine,
		prevPIDs: make(map[string]struct{}),
	}

	meter := provider.Meter("otelcol.gpu.occupancy",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	coreUsage, err := meter.Float64ObservableGauge("process.gpu.core.usage",
		metric.WithDescription("Model estimate of average CUDA cores used by a process (launch→sync thread-seconds, multi-process normalized). Not hardware SM occupancy."),
		metric.WithUnit("{cores}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.gpu.core.usage: %w", err)
	}

	procSMActive, err := meter.Float64ObservableGauge("process.gpu.sm_active",
		metric.WithDescription("Model estimate: fraction of the interval with any launch→sync span for this process (0–1). Not hardware SM occupancy."),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.gpu.sm_active: %w", err)
	}

	coreLimit, err := meter.Float64ObservableGauge("gpu.core.limit",
		metric.WithDescription("NVML CUDA core count for the device"),
		metric.WithUnit("{cores}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.core.limit: %w", err)
	}

	devSMActive, err := meter.Float64ObservableGauge("gpu.sm_active",
		metric.WithDescription("Model estimate: fraction of the interval with any launch→sync span on the device (0–1). Not hardware SM occupancy."),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.sm_active: %w", err)
	}

	reg, err := meter.RegisterCallback(func(ctx context.Context, o metric.Observer) error {
		res := om.engine.GetAndFlush()
		om.mu.Lock()
		defer om.mu.Unlock()

		seen := make(map[string]struct{})
		for _, p := range res.Processes {
			key := p.DeviceUUID + "|" + strconv.FormatUint(uint64(p.PID), 10)
			seen[key] = struct{}{}
			attrs := occupancyProcessAttrs(p.PID, p.DeviceUUID, devices)
			o.ObserveFloat64(coreUsage, p.UsedCores, metric.WithAttributeSet(attrs))
			o.ObserveFloat64(procSMActive, p.ActiveTime, metric.WithAttributeSet(attrs))
		}
		// Zero-on-leave
		for key := range om.prevPIDs {
			if _, ok := seen[key]; ok {
				continue
			}
			uuid, pidStr, _ := splitKey(key)
			pid64, _ := strconv.ParseUint(pidStr, 10, 32)
			attrs := occupancyProcessAttrs(uint32(pid64), uuid, devices)
			o.ObserveFloat64(coreUsage, 0, metric.WithAttributeSet(attrs))
			o.ObserveFloat64(procSMActive, 0, metric.WithAttributeSet(attrs))
		}
		om.prevPIDs = seen
		om.lastProcesses = res.Processes
		om.lastDevices = res.Devices

		emittedDev := make(map[string]bool)
		for _, d := range res.Devices {
			emittedDev[d.DeviceUUID] = true
			attrs := occupancyDeviceAttrs(d.DeviceUUID, devices)
			o.ObserveFloat64(devSMActive, d.ActiveTime, metric.WithAttributeSet(attrs))
			if d.CoreLimit > 0 {
				o.ObserveFloat64(coreLimit, d.CoreLimit, metric.WithAttributeSet(attrs))
			}
		}
		for _, d := range devices {
			info := d.Info()
			if info.Vendor != gpu.VendorNVIDIA || emittedDev[info.UUID] {
				continue
			}
			attrs := occupancyDeviceAttrs(info.UUID, devices)
			if info.CoreCount > 0 {
				o.ObserveFloat64(coreLimit, float64(info.CoreCount), metric.WithAttributeSet(attrs))
			}
		}
		return nil
	}, coreUsage, procSMActive, coreLimit, devSMActive)
	if err != nil {
		return nil, fmt.Errorf("registering occupancy callback: %w", err)
	}
	om.reg = reg
	return om, nil
}

func splitKey(key string) (uuid, pid string, ok bool) {
	for i := len(key) - 1; i >= 0; i-- {
		if key[i] == '|' {
			return key[:i], key[i+1:], true
		}
	}
	return "", "", false
}

func occupancyProcessAttrs(pid uint32, uuid string, devices []gpu.Device) attribute.Set {
	attrs := []attribute.KeyValue{
		attribute.String("hw.id", uuid),
		attribute.String("process.pid", strconv.FormatUint(uint64(pid), 10)),
	}
	// procname/workload APIs take int32; skip lookups for PIDs that would truncate.
	if pid <= math.MaxInt32 {
		pid32 := int32(pid)
		attrs = append(attrs, attribute.String("process.executable.name", procname.ExecutableName(pid32)))
		if pod, ok := workload.ResolvePod(pid32); ok && pod.PodUID != "" {
			attrs = append(attrs, attribute.String("k8s.pod.uid", pod.PodUID))
		}
	}
	for _, d := range devices {
		info := d.Info()
		if info.UUID == uuid {
			attrs = append(attrs,
				attribute.String("hw.name", info.Name),
				attribute.String("hw.vendor", string(info.Vendor)),
				attribute.Int("gpu.index", info.Index),
				attribute.String("gpu.pci_address", info.PCIAddress),
			)
			break
		}
	}
	return attribute.NewSet(attrs...)
}

func occupancyDeviceAttrs(uuid string, devices []gpu.Device) attribute.Set {
	attrs := []attribute.KeyValue{attribute.String("hw.id", uuid)}
	for _, d := range devices {
		info := d.Info()
		if info.UUID == uuid {
			attrs = append(attrs,
				attribute.String("hw.name", info.Name),
				attribute.String("hw.vendor", string(info.Vendor)),
				attribute.Int("gpu.index", info.Index),
				attribute.String("gpu.pci_address", info.PCIAddress),
			)
			break
		}
	}
	return attribute.NewSet(attrs...)
}

// HandleEvent feeds CUDA events into the occupancy engine.
func (om *OccupancyMetrics) HandleEvent(ev gpuebpf.CUDAEvent) {
	switch e := ev.(type) {
	case *gpuebpf.KernelLaunchEvent:
		om.engine.HandleLaunch(cudaoccupancy.KernelLaunch{
			PID: e.PID, TID: e.TID, StreamID: e.StreamID, KtimeNs: e.KtimeNs,
			GridX: e.GridX, GridY: e.GridY, GridZ: e.GridZ,
			BlockX: e.BlockX, BlockY: e.BlockY, BlockZ: e.BlockZ,
		})
	case *gpuebpf.SyncEvent:
		om.engine.HandleSync(cudaoccupancy.SyncEvent{
			PID: e.PID, TID: e.TID, StreamID: e.StreamID, KtimeNs: e.KtimeNs,
			DeviceWide: e.DeviceWide,
		})
	case *gpuebpf.SetDeviceEvent:
		om.engine.HandleSetDevice(cudaoccupancy.SetDeviceEvent{
			PID: e.PID, TID: e.TID, DeviceIdx: int(e.Device), KtimeNs: e.KtimeNs,
		})
	case *gpuebpf.MemcpyEvent:
		// Sync memcpy already emits SyncDevice from BPF; async memcpy does not close spans.
		_ = e
	}
}

// Engine exposes the underlying engine for tests.
func (om *OccupancyMetrics) Engine() *cudaoccupancy.Engine { return om.engine }

// Close unregisters callbacks.
func (om *OccupancyMetrics) Close() {
	if om.reg != nil {
		_ = om.reg.Unregister()
	}
}
