package export

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
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

	// preferGate skips NVML/amdsmi series that DCGM Prefer owns when Prefer
	// samples are healthy. Spec hw.gpu.memory.utilization (usage/limit) is never suppressed.
	preferGate PreferGate

	pcieMu      sync.Mutex
	pcieRxAccum map[string]int64 // hw.id -> cumulative bytes
	pcieTxAccum map[string]int64
	icRxAccum   map[string]int64
	icTxAccum   map[string]int64
	lastCollect time.Time
}

// PreferGate returns the Prefer coordination gate (shared with DCGMMetrics).
func (mc *MetricsCollector) PreferGate() *PreferGate {
	if mc == nil {
		return nil
	}
	return &mc.preferGate
}

// SetSuppressVendorOverlap enables Prefer ownership of overlapping vendor series.
func (mc *MetricsCollector) SetSuppressVendorOverlap(v bool) {
	if mc == nil {
		return
	}
	mc.preferGate.SetActive(v)
}

// NewMetricsCollector creates all GPU metric instruments and registers callbacks.
// Metric names and attributes follow the OpenTelemetry semantic conventions for hardware:
// https://opentelemetry.io/docs/specs/semconv/hardware/gpu/
func NewMetricsCollector(provider *sdkmetric.MeterProvider, devices []gpu.Device, logger *slog.Logger, cfg *config.Config) (*MetricsCollector, error) {
	if cfg == nil {
		cfg = config.Load()
	}
	mc := &MetricsCollector{
		devices:     devices,
		logger:      logger,
		cfg:         cfg,
		pods:        workload.NewEnricher(cfg, logger),
		pcieRxAccum: make(map[string]int64),
		pcieTxAccum: make(map[string]int64),
		icRxAccum:   make(map[string]int64),
		icTxAccum:   make(map[string]int64),
	}

	meter := provider.Meter("otelcol.gpu.collector",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	// --- Unchanged / retained metrics ---

	gpuUtilization, err := meter.Float64ObservableGauge("hw.gpu.utilization",
		metric.WithDescription("GPU utilization"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.utilization: %w", err)
	}

	memUtilization, err := meter.Float64ObservableGauge("hw.gpu.memory.utilization",
		metric.WithDescription("Fraction of GPU memory used (usage / limit)"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.memory.utilization: %w", err)
	}

	memControllerUtil, err := meter.Float64ObservableGauge("hw.gpu.memory.controller.utilization",
		metric.WithDescription("Fraction of time the GPU memory controller was busy (extension; not usage/limit)"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.memory.controller.utilization: %w", err)
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

	memFree, err := meter.Int64ObservableUpDownCounter("hw.gpu.memory.free",
		metric.WithDescription("Free GPU memory"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.memory.free: %w", err)
	}

	hwErrors, err := meter.Int64ObservableCounter("hw.errors",
		metric.WithDescription("GPU hardware error count"),
		metric.WithUnit("{error}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.errors: %w", err)
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

	procMemUsage, err := meter.Int64ObservableUpDownCounter("process.gpu.memory.usage",
		metric.WithDescription("GPU memory used by a process on a device"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.gpu.memory.usage: %w", err)
	}

	procMemUtil, err := meter.Float64ObservableGauge("process.gpu.memory.utilization",
		metric.WithDescription("Fraction of device GPU memory used by a process (process usage / device limit)"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.gpu.memory.utilization: %w", err)
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

	// --- Spec-corrected semantic convention metrics (always emitted) ---

	hwPower, err := meter.Float64ObservableGauge("hw.power",
		metric.WithDescription("GPU power draw"),
		metric.WithUnit("W"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.power: %w", err)
	}

	hwEnergy, err := meter.Float64ObservableCounter("hw.energy",
		metric.WithDescription("Cumulative GPU energy consumed"),
		metric.WithUnit("J"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.energy: %w", err)
	}

	hwTemperature, err := meter.Float64ObservableGauge("hw.temperature",
		metric.WithDescription("GPU temperature"),
		metric.WithUnit("Cel"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.temperature: %w", err)
	}

	hwFanSpeed, err := meter.Float64ObservableGauge("hw.fan.speed",
		metric.WithDescription("GPU fan speed"),
		metric.WithUnit("rpm"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.fan.speed: %w", err)
	}

	hwFanSpeedRatio, err := meter.Float64ObservableGauge("hw.fan.speed_ratio",
		metric.WithDescription("GPU fan speed as a fraction of maximum"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.fan.speed_ratio: %w", err)
	}

	hwGPUIO, err := meter.Int64ObservableCounter("hw.gpu.io",
		metric.WithDescription("Cumulative GPU PCIe I/O bytes"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.io: %w", err)
	}

	hwStatus, err := meter.Int64ObservableUpDownCounter("hw.status",
		metric.WithDescription("GPU hardware status (1 when the named state applies)"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.status: %w", err)
	}

	hwPowerLimit, err := meter.Float64ObservableGauge("hw.power.limit",
		metric.WithDescription("GPU power limit"),
		metric.WithUnit("W"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.power.limit: %w", err)
	}

	hwGPUSpeed, err := meter.Float64ObservableGauge("hw.gpu.speed",
		metric.WithDescription("GPU clock frequency"),
		metric.WithUnit("Hz"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.speed: %w", err)
	}

	hwInterconnectIO, err := meter.Int64ObservableCounter("hw.gpu.interconnect.io",
		metric.WithDescription("Cumulative GPU interconnect I/O bytes"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.interconnect.io: %w", err)
	}

	observables := []metric.Observable{
		gpuUtilization, memUtilization, memControllerUtil,
		memLimit, memUsage, memFree,
		hwErrors,
		gpuAllocated, gpuIdle,
		procMemUsage, procMemUtil, procUtil, procUptime,
		hwPower, hwEnergy, hwTemperature,
		hwFanSpeed, hwFanSpeedRatio,
		hwGPUIO, hwStatus, hwPowerLimit, hwGPUSpeed, hwInterconnectIO,
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			now := time.Now()
			mc.pcieMu.Lock()
			var elapsed time.Duration
			if mc.lastCollect.IsZero() {
				elapsed = mc.cfg.CollectionInterval
			} else {
				elapsed = now.Sub(mc.lastCollect)
			}
			if elapsed < 0 {
				elapsed = 0
			}
			mc.lastCollect = now
			mc.pcieMu.Unlock()

			for _, dev := range mc.devices {
				if err := ctx.Err(); err != nil {
					return err
				}
				info := dev.Info()
				attrs := deviceAttrs(info)

				snap, err := dev.Collect()
				if err != nil {
					mc.logger.Warn("collection failed", "gpu", info.Index, "error", err)
					failedAttrs := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("hw.state", "failed"),
					)...)
					o.ObserveInt64(hwStatus, 1, metric.WithAttributeSet(failedAttrs))
					// Clear mutually exclusive operational states when known.
					o.ObserveInt64(hwStatus, 0, metric.WithAttributeSet(attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("hw.state", "ok"),
					)...)))
					o.ObserveInt64(hwStatus, 0, metric.WithAttributeSet(attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("hw.state", "degraded"),
					)...)))
					continue
				}

				attrs = enrichSnapshotAttrs(attrs, snap)
				baseSlice := attrs.ToSlice()
				suppressOverlap := mc.preferGate.SuppressVendor(info.UUID)

				throttled := snap.Throttled != nil && *snap.Throttled == 1
				okVal, degVal := int64(1), int64(0)
				if throttled {
					okVal, degVal = 0, 1
				}
				o.ObserveInt64(hwStatus, okVal, metric.WithAttributeSet(attribute.NewSet(append(append([]attribute.KeyValue{}, baseSlice...),
					attribute.String("hw.state", "ok"),
				)...)))
				o.ObserveInt64(hwStatus, degVal, metric.WithAttributeSet(attribute.NewSet(append(append([]attribute.KeyValue{}, baseSlice...),
					attribute.String("hw.state", "degraded"),
				)...)))
				o.ObserveInt64(hwStatus, 0, metric.WithAttributeSet(attribute.NewSet(append(append([]attribute.KeyValue{}, baseSlice...),
					attribute.String("hw.state", "failed"),
				)...)))

				if snap.Utilization != nil {
					if !suppressOverlap {
						generalAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.gpu.task", "general"))...)
						o.ObserveFloat64(gpuUtilization, *snap.Utilization/100.0, metric.WithAttributeSet(generalAttrs))
						idle := 1.0 - clamp01(*snap.Utilization/100.0)
						o.ObserveFloat64(gpuIdle, idle, metric.WithAttributeSet(attrs))
					}
					// When Prefer owns util, idle is emitted from the DCGM Prefer path.
				}
				// Spec hw.gpu.memory.utilization = fraction of memory used (usage/limit).
				if snap.MemoryUsedBytes != nil && snap.MemoryTotalBytes != nil {
					if util, ok := processGPUMemoryUtilization(*snap.MemoryUsedBytes, *snap.MemoryTotalBytes); ok {
						o.ObserveFloat64(memUtilization, util, metric.WithAttributeSet(attrs))
					}
				}
				// Extension: memory controller / copy busy (NVML util.Memory, AMD mem_busy).
				if !suppressOverlap && snap.MemoryUtilization != nil {
					o.ObserveFloat64(memControllerUtil, *snap.MemoryUtilization/100.0, metric.WithAttributeSet(attrs))
				}
				// Encoder/decoder util have no DCGM Prefer equivalents; always emit from vendor.
				if snap.EncoderUtilization != nil {
					encAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.gpu.task", "encoder"))...)
					o.ObserveFloat64(gpuUtilization, *snap.EncoderUtilization/100.0, metric.WithAttributeSet(encAttrs))
				}
				if snap.DecoderUtilization != nil {
					decAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.gpu.task", "decoder"))...)
					o.ObserveFloat64(gpuUtilization, *snap.DecoderUtilization/100.0, metric.WithAttributeSet(decAttrs))
				}

				if snap.TemperatureGPU != nil {
					dieAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.sensor_location", "die"))...)
					o.ObserveFloat64(hwTemperature, *snap.TemperatureGPU, metric.WithAttributeSet(dieAttrs))
				}
				if snap.TemperatureMemory != nil {
					memTempAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.sensor_location", "memory"))...)
					o.ObserveFloat64(hwTemperature, *snap.TemperatureMemory, metric.WithAttributeSet(memTempAttrs))
				}

				if snap.FanSpeedRPM != nil {
					o.ObserveFloat64(hwFanSpeed, *snap.FanSpeedRPM, metric.WithAttributeSet(attrs))
				}
				if snap.FanSpeedRatio != nil {
					o.ObserveFloat64(hwFanSpeedRatio, *snap.FanSpeedRatio, metric.WithAttributeSet(attrs))
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

				if snap.PowerDrawWatts != nil && !suppressOverlap {
					o.ObserveFloat64(hwPower, *snap.PowerDrawWatts, metric.WithAttributeSet(attrs))
				}
				if snap.PowerLimitWatts != nil {
					limitAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.limit_type", "max"))...)
					o.ObserveFloat64(hwPowerLimit, *snap.PowerLimitWatts, metric.WithAttributeSet(limitAttrs))
				}
				if snap.EnergyJoules != nil {
					o.ObserveFloat64(hwEnergy, *snap.EnergyJoules, metric.WithAttributeSet(attrs))
				}

				// Graphics + SM clocks overlap DCGM Prefer field 100 (emitted as graphics).
				// Memory clock stays vendor (NVML) under Prefer.
				if snap.ClockGraphicsMHz != nil && !suppressOverlap {
					gfxAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.gpu.clock_domain", "graphics"))...)
					o.ObserveFloat64(hwGPUSpeed, *snap.ClockGraphicsMHz*1e6, metric.WithAttributeSet(gfxAttrs))
				}
				if snap.ClockSMMHz != nil && !suppressOverlap {
					smAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.gpu.clock_domain", "sm"))...)
					o.ObserveFloat64(hwGPUSpeed, *snap.ClockSMMHz*1e6, metric.WithAttributeSet(smAttrs))
				}
				if snap.ClockMemoryMHz != nil {
					memClkAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.gpu.clock_domain", "memory"))...)
					o.ObserveFloat64(hwGPUSpeed, *snap.ClockMemoryMHz*1e6, metric.WithAttributeSet(memClkAttrs))
				}

				if snap.PCIeReplayErrors != nil {
					pcieAttrs := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("error.type", "pcie_replay"),
					)...)
					o.ObserveInt64(hwErrors, *snap.PCIeReplayErrors, metric.WithAttributeSet(pcieAttrs))
				}
				if snap.ECCSingleBit != nil {
					corrAttrs := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("error.type", "corrected"),
					)...)
					o.ObserveInt64(hwErrors, *snap.ECCSingleBit, metric.WithAttributeSet(corrAttrs))
				}
				if snap.ECCDoubleBit != nil {
					uncorrAttrs := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("error.type", "uncorrected"),
					)...)
					o.ObserveInt64(hwErrors, *snap.ECCDoubleBit, metric.WithAttributeSet(uncorrAttrs))
				}
				if snap.XIDErrors != nil {
					xidAttrs := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("error.type", "xid"),
					)...)
					o.ObserveInt64(hwErrors, *snap.XIDErrors, metric.WithAttributeSet(xidAttrs))
				}
				if snap.RASCE != nil {
					a := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("error.type", "ras_corrected"),
					)...)
					o.ObserveInt64(hwErrors, *snap.RASCE, metric.WithAttributeSet(a))
				}
				if snap.RASUE != nil {
					a := attribute.NewSet(append(attrs.ToSlice(),
						attribute.String("error.type", "ras_uncorrected"),
					)...)
					o.ObserveInt64(hwErrors, *snap.RASUE, metric.WithAttributeSet(a))
				}

				// PCIe I/O: prefer cumulative totals; else integrate rate*interval.
				// Skipped when DCGM Prefer owns hw.gpu.io / interconnect.
				hwID := info.UUID
				if !suppressOverlap {
					rxTotal, rxOK := resolveIOBytes(hwID, snap.PCIeRxBytesTotal, snap.PCIeRxBytesPerSec, elapsed, &mc.pcieMu, mc.pcieRxAccum)
					if rxOK {
						rxAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("network.io.direction", "receive"))...)
						o.ObserveInt64(hwGPUIO, rxTotal, metric.WithAttributeSet(rxAttrs))
					}
					txTotal, txOK := resolveIOBytes(hwID, snap.PCIeTxBytesTotal, snap.PCIeTxBytesPerSec, elapsed, &mc.pcieMu, mc.pcieTxAccum)
					if txOK {
						txAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("network.io.direction", "transmit"))...)
						o.ObserveInt64(hwGPUIO, txTotal, metric.WithAttributeSet(txAttrs))
					}
				}

				if mc.cfg.InterconnectEnabled && !suppressOverlap {
					icType := snap.InterconnectType
					if icType == "" {
						icType = "other"
					}
					icRx, icRxOK := resolveIOBytes(hwID, snap.InterconnectRxBytesTotal, snap.InterconnectRxBytesPerSec, elapsed, &mc.pcieMu, mc.icRxAccum)
					if icRxOK {
						rx := attribute.NewSet(append(attrs.ToSlice(),
							attribute.String("network.io.direction", "receive"),
							attribute.String("hw.gpu.interconnect.type", icType),
						)...)
						o.ObserveInt64(hwInterconnectIO, icRx, metric.WithAttributeSet(rx))
					}
					icTx, icTxOK := resolveIOBytes(hwID, snap.InterconnectTxBytesTotal, snap.InterconnectTxBytesPerSec, elapsed, &mc.pcieMu, mc.icTxAccum)
					if icTxOK {
						tx := attribute.NewSet(append(attrs.ToSlice(),
							attribute.String("network.io.direction", "transmit"),
							attribute.String("hw.gpu.interconnect.type", icType),
						)...)
						o.ObserveInt64(hwInterconnectIO, icTx, metric.WithAttributeSet(tx))
					}
				}

				if snap.Throttled != nil {
					thAttrs := attrs.ToSlice()
					if snap.ThrottleReasons != nil && *snap.ThrottleReasons != "" {
						thAttrs = append(thAttrs, attribute.String("hw.gpu.throttle_reasons", *snap.ThrottleReasons))
					}
					// hw.status ok/degraded already emitted above from Throttled.
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
						if snap.MemoryTotalBytes != nil {
							if util, ok := processGPUMemoryUtilization(*pu.MemoryBytes, *snap.MemoryTotalBytes); ok {
								o.ObserveFloat64(procMemUtil, util, metric.WithAttributeSet(pattrs))
							}
						}
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
		observables...,
	)
	if err != nil {
		return nil, fmt.Errorf("registering callback: %w", err)
	}

	mc.reg = append(mc.reg, reg)
	return mc, nil
}

// resolveIOBytes returns the cumulative byte counter for a direction.
// Prefers explicit totals; otherwise integrates rate*elapsed into accum.
// ok is false when neither total nor rate is available.
func resolveIOBytes(hwID string, total *int64, ratePerSec *float64, elapsed time.Duration, mu *sync.Mutex, accum map[string]int64) (value int64, ok bool) {
	if total != nil {
		mu.Lock()
		accum[hwID] = *total
		mu.Unlock()
		return *total, true
	}
	if ratePerSec == nil {
		return 0, false
	}
	delta := int64(*ratePerSec * elapsed.Seconds())
	mu.Lock()
	accum[hwID] += delta
	value = accum[hwID]
	mu.Unlock()
	return value, true
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

// measurementSourceForVendor returns the gpu.measurement.source attr for vendor backends.
func measurementSourceForVendor(v gpu.Vendor) string {
	switch v {
	case gpu.VendorAMD:
		return "amdsmi"
	case gpu.VendorIntel:
		return "levelzero"
	default:
		return "nvml"
	}
}

// deviceAttrs returns the standard hw.* attribute set for a GPU device.
func deviceAttrs(info gpu.DeviceInfo) attribute.Set {
	attrs := []attribute.KeyValue{
		attribute.String("hw.id", info.UUID),
		attribute.String("hw.name", info.Name),
		attribute.String("hw.model", info.Name),
		attribute.String("hw.vendor", string(info.Vendor)),
		attribute.String("hw.type", "gpu"),
		attribute.Int("gpu.index", info.Index),
		attribute.String("gpu.pci_address", info.PCIAddress),
		attribute.String("gpu.measurement.source", measurementSourceForVendor(info.Vendor)),
	}
	if info.DriverVersion != "" {
		attrs = append(attrs, attribute.String("hw.driver_version", info.DriverVersion))
	}
	if info.IsMIG {
		attrs = append(attrs,
			attribute.Bool("gpu.mig.enabled", true),
			attribute.String("gpu.mig.device_id", info.MIGDeviceID),
			attribute.String("gpu.parent.uuid", info.ParentUUID),
		)
		if info.ParentUUID != "" {
			attrs = append(attrs, attribute.String("hw.parent", info.ParentUUID))
		}
		if info.MIGInstanceID >= 0 {
			attrs = append(attrs, attribute.Int("gpu.mig.instance_id", info.MIGInstanceID))
		}
		if info.MIGProfileName != "" {
			attrs = append(attrs, attribute.String("gpu.mig.profile", info.MIGProfileName))
		}
	}
	return attribute.NewSet(attrs...)
}

// enrichSnapshotAttrs adds serial/firmware from a collected snapshot when set.
func enrichSnapshotAttrs(attrs attribute.Set, snap *gpu.Snapshot) attribute.Set {
	if snap == nil || (snap.SerialNumber == "" && snap.FirmwareVersion == "") {
		return attrs
	}
	base := attrs.ToSlice()
	if snap.SerialNumber != "" {
		base = append(base, attribute.String("hw.serial_number", snap.SerialNumber))
	}
	if snap.FirmwareVersion != "" {
		base = append(base, attribute.String("hw.firmware_version", snap.FirmwareVersion))
	}
	return attribute.NewSet(base...)
}

func processAttrs(info gpu.DeviceInfo, pu gpu.ProcessUsage) attribute.Set {
	attrs := []attribute.KeyValue{
		attribute.String("hw.id", info.UUID),
		attribute.String("hw.name", info.Name),
		attribute.String("hw.model", info.Name),
		attribute.String("hw.vendor", string(info.Vendor)),
		attribute.String("hw.type", "gpu"),
		attribute.Int("gpu.index", info.Index),
		attribute.String("gpu.pci_address", info.PCIAddress),
		attribute.String("gpu.measurement.source", measurementSourceForVendor(info.Vendor)),
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

// processGPUMemoryUtilization returns process_mem/device_limit clamped to [0,1].
// ok is false when the ratio cannot be computed.
func processGPUMemoryUtilization(used, limit int64) (float64, bool) {
	if used < 0 || limit <= 0 {
		return 0, false
	}
	util := float64(used) / float64(limit)
	if util > 1 {
		util = 1
	}
	return util, true
}
