package export

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/classify"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/procinfo"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/workload"
)

// MetricsCollector registers OTel observable instruments that poll GPU devices on each collection cycle.
type MetricsCollector struct {
	devices []gpu.Device
	logger  *slog.Logger
	cfg     *config.Config
	pods    *workload.Enricher
	reg     []metric.Registration
}

// NewMetricsCollector creates all GPU metric instruments and registers callbacks.
// Metric names and attributes follow the OpenTelemetry semantic conventions for hardware:
// https://opentelemetry.io/docs/specs/semconv/hardware/gpu/
func NewMetricsCollector(provider *sdkmetric.MeterProvider, devices []gpu.Device, logger *slog.Logger, cfg *config.Config) (*MetricsCollector, error) {
	if cfg == nil {
		cfg = config.Load()
	}
	mc := &MetricsCollector{
		devices: devices,
		logger:  logger,
		cfg:     cfg,
		pods:    workload.NewEnricher(cfg, logger),
	}

	meter := provider.Meter("otelcol.gpu.collector",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	gpuUtilization, err := meter.Float64ObservableGauge("hw.gpu.utilization",
		metric.WithDescription("GPU utilization"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.utilization: %w", err)
	}

	memUtilization, err := meter.Float64ObservableGauge("hw.gpu.memory.utilization",
		metric.WithDescription("GPU memory utilization"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.memory.utilization: %w", err)
	}

	memLimit, err := meter.Int64ObservableUpDownCounter("hw.gpu.memory.limit",
		metric.WithDescription("Total GPU memory"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.memory.limit: %w", err)
	}

	memUsage, err := meter.Int64ObservableUpDownCounter("hw.gpu.memory.usage",
		metric.WithDescription("Used GPU memory"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.memory.usage: %w", err)
	}

	hwErrors, err := meter.Int64ObservableCounter("hw.errors",
		metric.WithDescription("GPU hardware error count"),
		metric.WithUnit("{error}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.errors: %w", err)
	}

	temperature, err := meter.Float64ObservableGauge("hw.gpu.temperature",
		metric.WithDescription("GPU temperature"),
		metric.WithUnit("Cel"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.temperature: %w", err)
	}

	fanSpeed, err := meter.Float64ObservableGauge("hw.gpu.fan_speed",
		metric.WithDescription("GPU fan speed"),
		metric.WithUnit("{rpm}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.fan_speed: %w", err)
	}

	memFree, err := meter.Int64ObservableUpDownCounter("hw.gpu.memory.free",
		metric.WithDescription("Free GPU memory"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.memory.free: %w", err)
	}

	powerDraw, err := meter.Float64ObservableGauge("hw.gpu.power.draw",
		metric.WithDescription("GPU power draw"),
		metric.WithUnit("W"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.power.draw: %w", err)
	}

	powerLimit, err := meter.Float64ObservableGauge("hw.gpu.power.limit",
		metric.WithDescription("GPU power limit"),
		metric.WithUnit("W"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.power.limit: %w", err)
	}

	energyConsumed, err := meter.Float64ObservableCounter("hw.gpu.energy.consumed",
		metric.WithDescription("Cumulative GPU energy consumed"),
		metric.WithUnit("J"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.energy.consumed: %w", err)
	}

	clockGraphics, err := meter.Float64ObservableGauge("hw.gpu.clock.graphics",
		metric.WithDescription("GPU graphics clock frequency"),
		metric.WithUnit("MHz"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.clock.graphics: %w", err)
	}

	clockMemory, err := meter.Float64ObservableGauge("hw.gpu.clock.memory",
		metric.WithDescription("GPU memory clock frequency"),
		metric.WithUnit("MHz"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.clock.memory: %w", err)
	}

	gpuUp, err := meter.Float64ObservableGauge("hw.gpu.up",
		metric.WithDescription("1 when the GPU was successfully scraped"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.up: %w", err)
	}

	gpuAllocated, err := meter.Float64ObservableGauge("hw.gpu.allocated",
		metric.WithDescription("1 when the GPU has process memory or util above threshold"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.allocated: %w", err)
	}

	gpuIdle, err := meter.Float64ObservableGauge("hw.gpu.idle",
		metric.WithDescription("Idle ratio (1 - utilization) when utilization is known"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.idle: %w", err)
	}

	pcieThroughput, err := meter.Float64ObservableGauge("hw.gpu.pcie.throughput",
		metric.WithDescription("PCIe throughput"),
		metric.WithUnit("By/s"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.pcie.throughput: %w", err)
	}

	interconnectThroughput, err := meter.Float64ObservableGauge("hw.gpu.interconnect.throughput",
		metric.WithDescription("GPU interconnect throughput (NVLink/XGMI)"),
		metric.WithUnit("By/s"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.interconnect.throughput: %w", err)
	}

	throttled, err := meter.Float64ObservableGauge("hw.gpu.throttled",
		metric.WithDescription("1 when clock throttle reasons are active"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.throttled: %w", err)
	}

	procMemUsage, err := meter.Int64ObservableUpDownCounter("process.gpu.memory.usage",
		metric.WithDescription("GPU memory used by a process on a device"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.gpu.memory.usage: %w", err)
	}

	procUtil, err := meter.Float64ObservableGauge("process.gpu.utilization",
		metric.WithDescription("Per-process GPU utilization (sampled; 0.0–1.0)"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.gpu.utilization: %w", err)
	}

	procUptime, err := meter.Float64ObservableGauge("process.uptime",
		metric.WithDescription("Process uptime in seconds for GPU-attributed processes"),
		metric.WithUnit("s"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.uptime: %w", err)
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			for _, dev := range mc.devices {
				if err := ctx.Err(); err != nil {
					return err
				}
				info := dev.Info()
				attrs := deviceAttrs(info)

				snap, err := dev.Collect()
				if err != nil {
					mc.logger.Warn("collection failed", "gpu", info.Index, "error", err)
					o.ObserveFloat64(gpuUp, 0, metric.WithAttributeSet(attrs))
					continue
				}

				o.ObserveFloat64(gpuUp, 1, metric.WithAttributeSet(attrs))

				if snap.Utilization != nil {
					generalAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.gpu.task", "general"))...)
					o.ObserveFloat64(gpuUtilization, *snap.Utilization/100.0, metric.WithAttributeSet(generalAttrs))
					idle := 1.0 - clamp01(*snap.Utilization/100.0)
					o.ObserveFloat64(gpuIdle, idle, metric.WithAttributeSet(attrs))
				}
				if snap.EncoderUtilization != nil {
					encAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.gpu.task", "encoder"))...)
					o.ObserveFloat64(gpuUtilization, *snap.EncoderUtilization/100.0, metric.WithAttributeSet(encAttrs))
				}
				if snap.DecoderUtilization != nil {
					decAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.gpu.task", "decoder"))...)
					o.ObserveFloat64(gpuUtilization, *snap.DecoderUtilization/100.0, metric.WithAttributeSet(decAttrs))
				}

				if snap.MemoryUtilization != nil {
					o.ObserveFloat64(memUtilization, *snap.MemoryUtilization/100.0, metric.WithAttributeSet(attrs))
				}

				if snap.TemperatureGPU != nil {
					dieAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("sensor", "die"))...)
					o.ObserveFloat64(temperature, *snap.TemperatureGPU, metric.WithAttributeSet(dieAttrs))
				}
				if snap.TemperatureMemory != nil {
					memTempAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("sensor", "memory"))...)
					o.ObserveFloat64(temperature, *snap.TemperatureMemory, metric.WithAttributeSet(memTempAttrs))
				}

				if snap.FanSpeedRPM != nil {
					o.ObserveFloat64(fanSpeed, *snap.FanSpeedRPM, metric.WithAttributeSet(attrs))
				}

				if snap.MemoryTotalBytes != nil {
					o.ObserveInt64(memLimit, *snap.MemoryTotalBytes, metric.WithAttributeSet(attrs))
				}
				if snap.MemoryUsedBytes != nil {
					o.ObserveInt64(memUsage, *snap.MemoryUsedBytes, metric.WithAttributeSet(attrs))
				}
				if snap.MemoryFreeBytes != nil {
					o.ObserveInt64(memFree, *snap.MemoryFreeBytes, metric.WithAttributeSet(attrs))
				}

				if snap.PowerDrawWatts != nil {
					o.ObserveFloat64(powerDraw, *snap.PowerDrawWatts, metric.WithAttributeSet(attrs))
				}
				if snap.PowerLimitWatts != nil {
					o.ObserveFloat64(powerLimit, *snap.PowerLimitWatts, metric.WithAttributeSet(attrs))
				}
				if snap.EnergyJoules != nil {
					o.ObserveFloat64(energyConsumed, *snap.EnergyJoules, metric.WithAttributeSet(attrs))
				}

				if snap.ClockGraphicsMHz != nil {
					o.ObserveFloat64(clockGraphics, *snap.ClockGraphicsMHz, metric.WithAttributeSet(attrs))
				}
				if snap.ClockMemoryMHz != nil {
					o.ObserveFloat64(clockMemory, *snap.ClockMemoryMHz, metric.WithAttributeSet(attrs))
				}

				if snap.PCIeReplayErrors != nil {
					pcieAttrs := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("hw.type", "gpu"),
						attribute.String("error.type", "pcie_replay"),
					)...)
					o.ObserveInt64(hwErrors, *snap.PCIeReplayErrors, metric.WithAttributeSet(pcieAttrs))
				}
				if snap.ECCSingleBit != nil {
					corrAttrs := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("hw.type", "gpu"),
						attribute.String("error.type", "corrected"),
					)...)
					o.ObserveInt64(hwErrors, *snap.ECCSingleBit, metric.WithAttributeSet(corrAttrs))
				}
				if snap.ECCDoubleBit != nil {
					uncorrAttrs := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("hw.type", "gpu"),
						attribute.String("error.type", "uncorrected"),
					)...)
					o.ObserveInt64(hwErrors, *snap.ECCDoubleBit, metric.WithAttributeSet(uncorrAttrs))
				}
				if snap.XIDErrors != nil {
					xidAttrs := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("hw.type", "gpu"),
						attribute.String("error.type", "xid"),
					)...)
					o.ObserveInt64(hwErrors, *snap.XIDErrors, metric.WithAttributeSet(xidAttrs))
				}
				if snap.RASCE != nil {
					a := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("hw.type", "gpu"),
						attribute.String("error.type", "ras_corrected"),
					)...)
					o.ObserveInt64(hwErrors, *snap.RASCE, metric.WithAttributeSet(a))
				}
				if snap.RASUE != nil {
					a := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("hw.type", "gpu"),
						attribute.String("error.type", "ras_uncorrected"),
					)...)
					o.ObserveInt64(hwErrors, *snap.RASUE, metric.WithAttributeSet(a))
				}

				if snap.PCIeRxBytesPerSec != nil {
					rx := attribute.NewSet(append(attrs.ToSlice(), attribute.String("network.io.direction", "receive"))...)
					o.ObserveFloat64(pcieThroughput, *snap.PCIeRxBytesPerSec, metric.WithAttributeSet(rx))
				}
				if snap.PCIeTxBytesPerSec != nil {
					tx := attribute.NewSet(append(attrs.ToSlice(), attribute.String("network.io.direction", "transmit"))...)
					o.ObserveFloat64(pcieThroughput, *snap.PCIeTxBytesPerSec, metric.WithAttributeSet(tx))
				}

				if mc.cfg.InterconnectEnabled {
					icType := snap.InterconnectType
					if icType == "" {
						icType = "other"
					}
					if snap.InterconnectRxBytesPerSec != nil {
						rx := attribute.NewSet(append(attrs.ToSlice(),
							attribute.String("network.io.direction", "receive"),
							attribute.String("hw.gpu.interconnect.type", icType),
						)...)
						o.ObserveFloat64(interconnectThroughput, *snap.InterconnectRxBytesPerSec, metric.WithAttributeSet(rx))
					}
					if snap.InterconnectTxBytesPerSec != nil {
						tx := attribute.NewSet(append(attrs.ToSlice(),
							attribute.String("network.io.direction", "transmit"),
							attribute.String("hw.gpu.interconnect.type", icType),
						)...)
						o.ObserveFloat64(interconnectThroughput, *snap.InterconnectTxBytesPerSec, metric.WithAttributeSet(tx))
					}
				}

				if snap.Throttled != nil {
					thAttrs := attrs.ToSlice()
					if snap.ThrottleReasons != nil && *snap.ThrottleReasons != "" {
						thAttrs = append(thAttrs, attribute.String("hw.gpu.throttle_reasons", *snap.ThrottleReasons))
					}
					o.ObserveFloat64(throttled, *snap.Throttled, metric.WithAttributeSet(attribute.NewSet(thAttrs...)))
				}

				procs, err := dev.CollectProcesses()
				if err != nil {
					mc.logger.Debug("CollectProcesses failed", "gpu", info.Index, "error", err)
					procs = nil
				}

				allocated := 0.0
				thresh := mc.cfg.AllocatedUtilThreshold
				if snap.Utilization != nil && *snap.Utilization/100.0 >= thresh {
					allocated = 1.0
				}
				procInfoCache := make(map[int32]procinfo.Info, len(procs))
				podCache := make(map[int32]workload.PodInfo, len(procs))
				for i := range procs {
					enrichProcess(mc.cfg, &procs[i], mc.pods, info.UUID, procInfoCache, podCache)
					if procs[i].MemoryBytes != nil && *procs[i].MemoryBytes > 0 {
						allocated = 1.0
					}
				}
				o.ObserveFloat64(gpuAllocated, allocated, metric.WithAttributeSet(attrs))

				for _, pu := range procs {
					pattrs := mc.attrsForProcess(info, pu, podCache)
					base := pattrs.ToSlice()
					if pu.MemoryBytes != nil {
						o.ObserveInt64(procMemUsage, *pu.MemoryBytes, metric.WithAttributeSet(pattrs))
					}
					if pu.Utilization != nil {
						general := attribute.NewSet(append(append([]attribute.KeyValue{}, base...), attribute.String("hw.gpu.task", "general"))...)
						o.ObserveFloat64(procUtil, *pu.Utilization, metric.WithAttributeSet(general))
					}
					if pu.EncoderUtil != nil {
						enc := attribute.NewSet(append(append([]attribute.KeyValue{}, base...), attribute.String("hw.gpu.task", "encoder"))...)
						o.ObserveFloat64(procUtil, *pu.EncoderUtil, metric.WithAttributeSet(enc))
					}
					if pu.DecoderUtil != nil {
						dec := attribute.NewSet(append(append([]attribute.KeyValue{}, base...), attribute.String("hw.gpu.task", "decoder"))...)
						o.ObserveFloat64(procUtil, *pu.DecoderUtil, metric.WithAttributeSet(dec))
					}
					if !pu.StartTime.IsZero() {
						o.ObserveFloat64(procUptime, time.Since(pu.StartTime).Seconds(), metric.WithAttributeSet(pattrs))
					}
				}
			}
			return nil
		},
		gpuUtilization, memUtilization,
		memLimit, memUsage, memFree,
		temperature, fanSpeed,
		powerDraw, powerLimit, energyConsumed,
		clockGraphics, clockMemory,
		hwErrors,
		gpuUp, gpuAllocated, gpuIdle,
		pcieThroughput, interconnectThroughput, throttled,
		procMemUsage, procUtil, procUptime,
	)
	if err != nil {
		return nil, fmt.Errorf("registering callback: %w", err)
	}

	mc.reg = append(mc.reg, reg)
	return mc, nil
}

func enrichProcess(cfg *config.Config, pu *gpu.ProcessUsage, pods *workload.Enricher, deviceID string, cache map[int32]procinfo.Info, podCache map[int32]workload.PodInfo) {
	info, ok := cache[pu.PID]
	if !ok {
		info = procinfo.Lookup(pu.PID)
		cache[pu.PID] = info
	}
	if cfg.ProcessCmdline && info.CommandLine != "" {
		pu.CommandLine = truncate(info.CommandLine, cfg.ProcessCmdlineMaxLen)
	}
	pu.UserID = info.UserID
	pu.Username = info.Username
	pu.State = info.State
	pu.StartTime = info.StartTime

	// Classify from full cmdline; attribute export may use a truncated copy.
	cl := classify.FromProcess(pu.ExecutableName, info.CommandLine)
	pu.WorkloadKind = cl.Kind
	pu.WorkloadFramework = cl.Framework

	if pods != nil {
		if pod, ok := pods.Resolve(pu.PID, deviceID); ok {
			podCache[pu.PID] = pod
			if pu.ContainerID == "" && pod.ContainerID != "" {
				pu.ContainerID = pod.ContainerID
			}
		}
	}
}

func truncate(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max]
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// Close unregisters all metric callbacks.
func (mc *MetricsCollector) Close() {
	for _, r := range mc.reg {
		_ = r.Unregister()
	}
	if mc.pods != nil {
		mc.pods.Close()
	}
}

// deviceAttrs returns the standard hw.* attribute set for a GPU device.
func deviceAttrs(info gpu.DeviceInfo) attribute.Set {
	attrs := []attribute.KeyValue{
		attribute.String("hw.id", info.UUID),
		attribute.String("hw.name", info.Name),
		attribute.String("hw.vendor", string(info.Vendor)),
		attribute.Int("gpu.index", info.Index),
		attribute.String("gpu.pci_address", info.PCIAddress),
	}
	if info.IsMIG {
		attrs = append(attrs,
			attribute.Bool("gpu.mig.enabled", true),
			attribute.String("gpu.mig.device_id", info.MIGDeviceID),
			attribute.String("gpu.parent.uuid", info.ParentUUID),
		)
		if info.MIGInstanceID >= 0 {
			attrs = append(attrs, attribute.Int("gpu.mig.instance_id", info.MIGInstanceID))
		}
		if info.MIGProfileName != "" {
			attrs = append(attrs, attribute.String("gpu.mig.profile", info.MIGProfileName))
		}
	}
	return attribute.NewSet(attrs...)
}

func processAttrs(info gpu.DeviceInfo, pu gpu.ProcessUsage) attribute.Set {
	attrs := []attribute.KeyValue{
		attribute.String("hw.id", info.UUID),
		attribute.String("hw.name", info.Name),
		attribute.String("hw.vendor", string(info.Vendor)),
		attribute.Int("gpu.index", info.Index),
		attribute.String("gpu.pci_address", info.PCIAddress),
		attribute.String("process.pid", strconv.FormatInt(int64(pu.PID), 10)),
		attribute.String("process.executable.name", pu.ExecutableName),
	}
	if pu.CommandLine != "" {
		attrs = append(attrs, attribute.String("process.command_line", pu.CommandLine))
	}
	if pu.State != "" {
		attrs = append(attrs, attribute.String("process.state", pu.State))
	}
	if pu.UserID != "" {
		attrs = append(attrs, attribute.String("process.owner.userid", pu.UserID))
	}
	if pu.Username != "" {
		attrs = append(attrs, attribute.String("process.owner", pu.Username))
	}
	// process.start_time is intentionally omitted from metric attributes (high
	// cardinality). process.uptime already covers process lifetime.
	if pu.WorkloadKind != "" {
		attrs = append(attrs, attribute.String("process.workload.kind", pu.WorkloadKind))
	}
	if pu.WorkloadFramework != "" {
		attrs = append(attrs, attribute.String("process.workload.framework", pu.WorkloadFramework))
	}
	if pu.ContainerID != "" {
		attrs = append(attrs, attribute.String("container.id", pu.ContainerID))
	}
	return attribute.NewSet(attrs...)
}

// processAttrsWithPod merges pod enrichment into process attributes.
func processAttrsWithPod(info gpu.DeviceInfo, pu gpu.ProcessUsage, pod workload.PodInfo) attribute.Set {
	set := processAttrs(info, pu)
	base := set.ToSlice()
	if pod.PodUID != "" {
		base = append(base, attribute.String("k8s.pod.uid", pod.PodUID))
	}
	if pod.PodName != "" {
		base = append(base, attribute.String("k8s.pod.name", pod.PodName))
	}
	if pod.Namespace != "" {
		base = append(base, attribute.String("k8s.namespace.name", pod.Namespace))
	}
	if pod.ContainerName != "" {
		base = append(base, attribute.String("k8s.container.name", pod.ContainerName))
	}
	if pod.ContainerID != "" && pu.ContainerID == "" {
		base = append(base, attribute.String("container.id", pod.ContainerID))
	}
	return attribute.NewSet(base...)
}

// Used by callback — resolve pod and build attrs.
func (mc *MetricsCollector) attrsForProcess(info gpu.DeviceInfo, pu gpu.ProcessUsage, podCache map[int32]workload.PodInfo) attribute.Set {
	if pod, ok := podCache[pu.PID]; ok {
		return processAttrsWithPod(info, pu, pod)
	}
	return processAttrs(info, pu)
}
