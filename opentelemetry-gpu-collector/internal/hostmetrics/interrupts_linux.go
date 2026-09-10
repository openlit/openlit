//go:build linux

package hostmetrics

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

const interruptsPath = "/proc/interrupts"

// InterruptsCollector emits system.interrupt.count from /proc/interrupts.
type InterruptsCollector struct {
	logger *slog.Logger
	perCPU bool
	path   string
	reg    []metric.Registration
}

// NewInterruptsCollector registers interrupt metrics. Soft-fails (returns nil error
// with a disabled collector) when /proc/interrupts is missing.
func NewInterruptsCollector(provider *sdkmetric.MeterProvider, logger *slog.Logger, perCPU bool) (*InterruptsCollector, error) {
	return newInterruptsCollector(provider, logger, perCPU, interruptsPath)
}

func newInterruptsCollector(provider *sdkmetric.MeterProvider, logger *slog.Logger, perCPU bool, path string) (*InterruptsCollector, error) {
	if _, err := os.Stat(path); err != nil {
		logger.Info("interrupts metrics unavailable; skipping", "path", path, "error", err)
		return &InterruptsCollector{logger: logger}, nil
	}

	c := &InterruptsCollector{
		logger: logger,
		perCPU: perCPU,
		path:   path,
	}

	meter := provider.Meter("otelcol.system.interrupts",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	irqCount, err := meter.Int64ObservableCounter("system.interrupt.count",
		metric.WithDescription("Interrupt count by name"),
		metric.WithUnit("{interrupt}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.interrupt.count: %w", err)
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			c.collect(o, irqCount)
			return nil
		},
		irqCount,
	)
	if err != nil {
		return nil, fmt.Errorf("registering interrupts callback: %w", err)
	}
	c.reg = append(c.reg, reg)
	logger.Info("interrupts metrics collector initialized", "per_cpu", perCPU)
	return c, nil
}

func (c *InterruptsCollector) collect(o metric.Observer, irqCount metric.Int64ObservableCounter) {
	if c.path == "" {
		return
	}
	f, err := os.Open(c.path)
	if err != nil {
		c.logger.Debug("interrupts open error", "error", err)
		return
	}
	defer f.Close()

	stats, err := ParseInterrupts(f)
	if err != nil {
		c.logger.Debug("interrupts parse error", "error", err)
		return
	}

	for _, s := range stats {
		name := s.DisplayName()
		if c.perCPU {
			for cpu, v := range s.PerCPU {
				n, ok := uint64ToInt64(v)
				if !ok {
					continue
				}
				o.ObserveInt64(irqCount, n,
					metric.WithAttributes(
						attribute.String("system.interrupt.name", name),
						attribute.Int("cpu.logical_number", cpu),
					),
				)
			}
			continue
		}
		if n, ok := uint64ToInt64(s.Total()); ok {
			o.ObserveInt64(irqCount, n,
				metric.WithAttributes(attribute.String("system.interrupt.name", name)),
			)
		}
	}
}

// Close unregisters callbacks.
func (c *InterruptsCollector) Close() {
	if c == nil {
		return
	}
	for _, r := range c.reg {
		_ = r.Unregister()
	}
}
