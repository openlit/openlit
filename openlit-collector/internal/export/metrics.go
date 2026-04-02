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
// Metric names and attributes follow the OpenTelemetry semantic conventions for hardware:
// https://opentelemetry.io/docs/specs/semconv/hardware/gpu/
func NewMetricsCollector(provider *sdkmetric.MeterProvider, devices []gpu.Device, logger *slog.Logger) (*MetricsCollector, error) {
	mc := &MetricsCollector{
		devices: devices,
		logger:  logger,
	}

	meter := provider.Meter("openlit.gpu.collector",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	// hw.gpu.utilization — general + encoder + decoder via hw.gpu.task attribute
	gpuUtilization, err := meter.Float64ObservableGauge("hw.gpu.utilization",
		metric.WithDescription("GPU utilization"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.utilization: %w", err)
	}

	// hw.gpu.memory.utilization
	memUtilization, err := meter.Float64ObservableGauge("hw.gpu.memory.utilization",
		metric.WithDescription("GPU memory utilization"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.memory.utilization: %w", err)
	}

	// hw.gpu.memory.limit — total memory
	memLimit, err := meter.Int64ObservableUpDownCounter("hw.gpu.memory.limit",
		metric.WithDescription("Total GPU memory"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.memory.limit: %w", err)
	}

	// hw.gpu.memory.usage — used memory
	memUsage, err := meter.Int64ObservableUpDownCounter("hw.gpu.memory.usage",
		metric.WithDescription("Used GPU memory"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.memory.usage: %w", err)
	}

	// hw.errors — ECC and PCIe errors
	hwErrors, err := meter.Int64ObservableCounter("hw.errors",
		metric.WithDescription("GPU hardware error count"),
		metric.WithUnit("{error}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.errors: %w", err)
	}

	// Custom metrics not covered by the spec
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
					generalAttrs := attribute.NewSet(append(attrs.ToSlice(), attribute.String("hw.gpu.task", "general"))...)
					o.ObserveFloat64(gpuUtilization, *snap.Utilization/100.0, metric.WithAttributeSet(generalAttrs))
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
			}
			return nil
		},
		gpuUtilization, memUtilization,
		memLimit, memUsage, memFree,
		temperature, fanSpeed,
		powerDraw, powerLimit, energyConsumed,
		clockGraphics, clockMemory,
		hwErrors,
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

// deviceAttrs returns the standard hw.* attribute set for a GPU device.
// hw.id is required; hw.name, hw.vendor are recommended by the spec.
func deviceAttrs(info gpu.DeviceInfo) attribute.Set {
	return attribute.NewSet(
		attribute.String("hw.id", info.UUID),
		attribute.String("hw.name", info.Name),
		attribute.String("hw.vendor", string(info.Vendor)),
		attribute.Int("gpu.index", info.Index),
		attribute.String("gpu.pci_address", info.PCIAddress),
	)
}
