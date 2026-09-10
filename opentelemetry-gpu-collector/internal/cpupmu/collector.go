package cpupmu

import (
	"context"
	"fmt"
	"log/slog"
	"sync/atomic"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
)

// Collector emits hw.cpu.* PMU metrics.
type Collector struct {
	logger *slog.Logger
	reader Reader
	reg    []metric.Registration
	avail  atomic.Int64 // 1 or 0
}

// NewCollector registers PMU instruments. Soft-fails when perf is unavailable:
// instruments still register and openlit.collector.pmu.available stays 0.
func NewCollector(provider *sdkmetric.MeterProvider, cfg *config.Config, logger *slog.Logger) (*Collector, error) {
	return NewCollectorWithReader(provider, cfg, NewReader(cfg.PMUEvents, logger), logger)
}

// NewCollectorWithReader is like NewCollector but injects a Reader (tests).
func NewCollectorWithReader(provider *sdkmetric.MeterProvider, cfg *config.Config, reader Reader, logger *slog.Logger) (*Collector, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if reader == nil {
		reader = &UnavailableReader{}
	}
	c := &Collector{logger: logger, reader: reader}
	if reader.Available() {
		c.avail.Store(1)
	}

	meter := provider.Meter("otelcol.cpupmu",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	instructions, err := meter.Int64ObservableCounter("hw.cpu.instructions",
		metric.WithDescription("CPU instructions retired"),
		metric.WithUnit("{instruction}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.cpu.instructions: %w", err)
	}

	cycles, err := meter.Int64ObservableCounter("hw.cpu.cycles",
		metric.WithDescription("CPU cycles"),
		metric.WithUnit("{cycle}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.cpu.cycles: %w", err)
	}

	cacheEvents, err := meter.Int64ObservableCounter("hw.cpu.cache.events",
		metric.WithDescription("CPU cache events"),
		metric.WithUnit("{event}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.cpu.cache.events: %w", err)
	}

	branchEvents, err := meter.Int64ObservableCounter("hw.cpu.branch.events",
		metric.WithDescription("CPU branch events"),
		metric.WithUnit("{event}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.cpu.branch.events: %w", err)
	}

	tlbEvents, err := meter.Int64ObservableCounter("hw.cpu.tlb.events",
		metric.WithDescription("CPU TLB events"),
		metric.WithUnit("{event}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.cpu.tlb.events: %w", err)
	}

	memIO, err := meter.Int64ObservableCounter("hw.cpu.memory.io",
		metric.WithDescription("Cumulative DRAM bytes inferred from uncore IMC/UMC counters"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.cpu.memory.io: %w", err)
	}

	available, err := meter.Int64ObservableGauge("openlit.collector.pmu.available",
		metric.WithDescription("1 if CPU PMU counters are available, else 0"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating openlit.collector.pmu.available: %w", err)
	}

	_ = cfg // reserved for future event filtering at observe time

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			c.observe(ctx, o, instructions, cycles, cacheEvents, branchEvents, tlbEvents, memIO, available)
			return nil
		},
		instructions, cycles, cacheEvents, branchEvents, tlbEvents, memIO, available,
	)
	if err != nil {
		_ = reader.Close()
		return nil, fmt.Errorf("registering pmu callback: %w", err)
	}
	c.reg = append(c.reg, reg)
	logger.Info("CPU PMU collector initialized", "available", reader.Available())
	return c, nil
}

// Close releases perf fds and unregisters callbacks.
func (c *Collector) Close() {
	for _, r := range c.reg {
		_ = r.Unregister()
	}
	if c.reader != nil {
		_ = c.reader.Close()
	}
}

func (c *Collector) observe(
	_ context.Context,
	o metric.Observer,
	instructions, cycles, cacheEvents, branchEvents, tlbEvents, memIO metric.Int64ObservableCounter,
	available metric.Int64ObservableGauge,
) {
	o.ObserveInt64(available, c.avail.Load())
	if !c.reader.Available() {
		return
	}
	samples, err := c.reader.Read()
	if err != nil {
		c.logger.Debug("pmu read error", "error", err)
		c.avail.Store(0)
		return
	}
	for _, s := range samples {
		switch s.Name {
		case "instructions":
			o.ObserveInt64(instructions, int64(s.Value))
		case "cycles":
			o.ObserveInt64(cycles, int64(s.Value))
		case "cache":
			o.ObserveInt64(cacheEvents, int64(s.Value), metric.WithAttributes(attrsFrom(s.Attrs)...))
		case "branch":
			o.ObserveInt64(branchEvents, int64(s.Value), metric.WithAttributes(attrsFrom(s.Attrs)...))
		case "tlb":
			o.ObserveInt64(tlbEvents, int64(s.Value), metric.WithAttributes(attrsFrom(s.Attrs)...))
		case "memory_io":
			o.ObserveInt64(memIO, int64(s.Value), metric.WithAttributes(attrsFrom(s.Attrs)...))
		}
	}
}

func attrsFrom(m map[string]string) []attribute.KeyValue {
	if len(m) == 0 {
		return nil
	}
	out := make([]attribute.KeyValue, 0, len(m))
	for k, v := range m {
		out = append(out, attribute.String(k, v))
	}
	return out
}
