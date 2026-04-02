package export

import (
	"context"
	"fmt"
	"log/slog"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/openlit/openlit/openlit-collector/internal/gpu"
)

// MetricsCollector registers OTel observable instruments that poll GPU devices on each collection cycle.
type MetricsCollector struct {
	devices []gpu.Device
	logger  *slog.Logger
	reg     []metric.Registration
}

// NewMetricsCollector creates all GPU metric instruments and registers callbacks.
func NewMetricsCollector(provider *sdkmetric.MeterProvider, devices []gpu.Device, logger *slog.Logger) (*MetricsCollector, error) {
	mc := &MetricsCollector{
		devices: devices,
		logger:  logger,
	}

	meter := provider.Meter("openlit.gpu.collector",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	utilization, err := meter.Float64ObservableGauge("gpu.utilization",
		metric.WithDescription("GPU compute utilization"),
		metric.WithUnit("percent"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.utilization: %w", err)
	}

	memUtilization, err := meter.Float64ObservableGauge("gpu.memory.utilization",
		metric.WithDescription("GPU memory controller utilization"),
		metric.WithUnit("percent"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.memory.utilization: %w", err)
	}

	encUtilization, err := meter.Float64ObservableGauge("gpu.enc.utilization",
		metric.WithDescription("GPU encoder utilization"),
		metric.WithUnit("percent"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.enc.utilization: %w", err)
	}

	decUtilization, err := meter.Float64ObservableGauge("gpu.dec.utilization",
		metric.WithDescription("GPU decoder utilization"),
		metric.WithUnit("percent"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.dec.utilization: %w", err)
	}

	temperature, err := meter.Float64ObservableGauge("gpu.temperature",
		metric.WithDescription("GPU temperature"),
		metric.WithUnit("celsius"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.temperature: %w", err)
	}

	fanSpeed, err := meter.Float64ObservableGauge("gpu.fan_speed",
		metric.WithDescription("GPU fan speed"),
		metric.WithUnit("rpm"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.fan_speed: %w", err)
	}

	memTotal, err := meter.Int64ObservableGauge("gpu.memory.total",
		metric.WithDescription("Total GPU memory"),
		metric.WithUnit("bytes"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.memory.total: %w", err)
	}

	memUsed, err := meter.Int64ObservableGauge("gpu.memory.used",
		metric.WithDescription("Used GPU memory"),
		metric.WithUnit("bytes"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.memory.used: %w", err)
	}

	memFree, err := meter.Int64ObservableGauge("gpu.memory.free",
		metric.WithDescription("Free GPU memory"),
		metric.WithUnit("bytes"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.memory.free: %w", err)
	}

	powerDraw, err := meter.Float64ObservableGauge("gpu.power.draw",
		metric.WithDescription("GPU power draw"),
		metric.WithUnit("watts"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.power.draw: %w", err)
	}

	powerLimit, err := meter.Float64ObservableGauge("gpu.power.limit",
		metric.WithDescription("GPU power limit"),
		metric.WithUnit("watts"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.power.limit: %w", err)
	}

	energyConsumed, err := meter.Float64ObservableCounter("gpu.energy.consumed",
		metric.WithDescription("Cumulative GPU energy consumed"),
		metric.WithUnit("joules"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.energy.consumed: %w", err)
	}

	clockGraphics, err := meter.Float64ObservableGauge("gpu.clock.graphics",
		metric.WithDescription("GPU graphics clock frequency"),
		metric.WithUnit("mhz"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.clock.graphics: %w", err)
	}

	clockMemory, err := meter.Float64ObservableGauge("gpu.clock.memory",
		metric.WithDescription("GPU memory clock frequency"),
		metric.WithUnit("mhz"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.clock.memory: %w", err)
	}

	pcieErrors, err := meter.Int64ObservableCounter("gpu.pcie.replay.errors",
		metric.WithDescription("PCIe replay error count"),
		metric.WithUnit("{error}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.pcie.replay.errors: %w", err)
	}

	eccErrors, err := meter.Int64ObservableCounter("gpu.ecc.errors",
		metric.WithDescription("GPU ECC error count"),
		metric.WithUnit("{error}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.ecc.errors: %w", err)
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			for _, dev := range mc.devices {
				snap, err := dev.Collect()
				if err != nil {
					mc.logger.Warn("collection failed", "gpu", dev.Info().Index, "error", err)
					continue
				}

				info := dev.Info()
				attrs := deviceAttrs(info)

				if snap.Utilization != nil {
					o.ObserveFloat64(utilization, *snap.Utilization, metric.WithAttributeSet(attrs))
				}
				if snap.MemoryUtilization != nil {
					o.ObserveFloat64(memUtilization, *snap.MemoryUtilization, metric.WithAttributeSet(attrs))
				}
				if snap.EncoderUtilization != nil {
					o.ObserveFloat64(encUtilization, *snap.EncoderUtilization, metric.WithAttributeSet(attrs))
				}
				if snap.DecoderUtilization != nil {
					o.ObserveFloat64(decUtilization, *snap.DecoderUtilization, metric.WithAttributeSet(attrs))
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
					o.ObserveInt64(memTotal, *snap.MemoryTotalBytes, metric.WithAttributeSet(attrs))
				}
				if snap.MemoryUsedBytes != nil {
					o.ObserveInt64(memUsed, *snap.MemoryUsedBytes, metric.WithAttributeSet(attrs))
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
					o.ObserveInt64(pcieErrors, *snap.PCIeReplayErrors, metric.WithAttributeSet(attrs))
				}

				if snap.ECCSingleBit != nil {
					sbAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("severity", "single_bit"))...)
					o.ObserveInt64(eccErrors, *snap.ECCSingleBit, metric.WithAttributeSet(sbAttrs))
				}
				if snap.ECCDoubleBit != nil {
					dbAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("severity", "double_bit"))...)
					o.ObserveInt64(eccErrors, *snap.ECCDoubleBit, metric.WithAttributeSet(dbAttrs))
				}
			}
			return nil
		},
		utilization, memUtilization, encUtilization, decUtilization,
		temperature, fanSpeed,
		memTotal, memUsed, memFree,
		powerDraw, powerLimit, energyConsumed,
		clockGraphics, clockMemory,
		pcieErrors, eccErrors,
	)
	if err != nil {
		return nil, fmt.Errorf("registering callback: %w", err)
	}

	mc.reg = append(mc.reg, reg)
	return mc, nil
}

// Close unregisters all metric callbacks.
func (mc *MetricsCollector) Close() {
	for _, r := range mc.reg {
		_ = r.Unregister()
	}
}

func deviceAttrs(info gpu.DeviceInfo) attribute.Set {
	return attribute.NewSet(
		attribute.String("vendor", string(info.Vendor)),
		attribute.Int("gpu_index", info.Index),
		attribute.String("gpu_name", info.Name),
		attribute.String("gpu_uuid", info.UUID),
		attribute.String("pci_address", info.PCIAddress),
	)
}
