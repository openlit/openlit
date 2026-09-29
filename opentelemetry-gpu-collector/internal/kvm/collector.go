package kvm

import (
	"context"
	"fmt"
	"log/slog"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

const defaultDebugFS = "/sys/kernel/debug/kvm"

// Collector emits system.kvm.* metrics from KVM debugfs.
type Collector struct {
	logger *slog.Logger
	root   string
	reg    []metric.Registration
}

// NewCollector registers KVM metrics when debugfs is available. Soft-fails
// (nil error, empty collector) when the path is missing or unreadable.
func NewCollector(provider *sdkmetric.MeterProvider, logger *slog.Logger) (*Collector, error) {
	return newCollector(provider, logger, defaultDebugFS)
}

func newCollector(provider *sdkmetric.MeterProvider, logger *slog.Logger, root string) (*Collector, error) {
	if !platformKVMSupported() {
		logger.Info("KVM metrics unavailable on this platform")
		return &Collector{logger: logger}, nil
	}

	if _, err := ReadDir(root); err != nil {
		logger.Info("KVM debugfs unavailable; skipping", "path", root, "error", err)
		return &Collector{logger: logger}, nil
	}

	c := &Collector{logger: logger, root: root}
	meter := provider.Meter("otelcol.system.kvm",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	exits, err := meter.Int64ObservableCounter("system.kvm.exits",
		metric.WithDescription("KVM exit count by type"),
		metric.WithUnit("{exit}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.kvm.exits: %w", err)
	}

	emulated, err := meter.Int64ObservableCounter("system.kvm.emulated.instructions",
		metric.WithDescription("KVM emulated instructions"),
		metric.WithUnit("{instruction}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.kvm.emulated.instructions: %w", err)
	}

	hypercalls, err := meter.Int64ObservableCounter("system.kvm.hypercalls",
		metric.WithDescription("KVM hypercall count"),
		metric.WithUnit("{call}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.kvm.hypercalls: %w", err)
	}

	haltPoll, err := meter.Int64ObservableCounter("system.kvm.halt_poll",
		metric.WithDescription("KVM halt poll events"),
		metric.WithUnit("{poll}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.kvm.halt_poll: %w", err)
	}

	tlb, err := meter.Int64ObservableCounter("system.kvm.tlb.flushes",
		metric.WithDescription("KVM TLB flush count"),
		metric.WithUnit("{flush}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.kvm.tlb.flushes: %w", err)
	}

	mmu, err := meter.Int64ObservableCounter("system.kvm.mmu.events",
		metric.WithDescription("KVM MMU events"),
		metric.WithUnit("{event}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.kvm.mmu.events: %w", err)
	}

	pages, err := meter.Int64ObservableUpDownCounter("system.kvm.pages",
		metric.WithDescription("KVM page counts by size"),
		metric.WithUnit("{page}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.kvm.pages: %w", err)
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			c.collect(o, exits, emulated, hypercalls, haltPoll, tlb, mmu, pages)
			return nil
		},
		exits, emulated, hypercalls, haltPoll, tlb, mmu, pages,
	)
	if err != nil {
		return nil, fmt.Errorf("registering kvm callback: %w", err)
	}
	c.reg = append(c.reg, reg)
	logger.Info("KVM metrics collector initialized", "path", root)
	return c, nil
}

func (c *Collector) collect(
	o metric.Observer,
	exits metric.Int64ObservableCounter,
	emulated metric.Int64ObservableCounter,
	hypercalls metric.Int64ObservableCounter,
	haltPoll metric.Int64ObservableCounter,
	tlb metric.Int64ObservableCounter,
	mmu metric.Int64ObservableCounter,
	pages metric.Int64ObservableUpDownCounter,
) {
	if c.root == "" {
		return
	}
	snap, err := ReadDir(c.root)
	if err != nil {
		c.logger.Debug("kvm read error", "error", err)
		return
	}

	for typ, v := range snap.Exits {
		o.ObserveInt64(exits, int64(v),
			metric.WithAttributes(attribute.String("system.kvm.exit.type", typ)),
		)
	}
	for result, v := range snap.EmulatedInstructions {
		o.ObserveInt64(emulated, int64(v),
			metric.WithAttributes(attribute.String("result", result)),
		)
	}
	o.ObserveInt64(hypercalls, int64(snap.Hypercalls))
	for result, v := range snap.HaltPoll {
		o.ObserveInt64(haltPoll, int64(v),
			metric.WithAttributes(attribute.String("result", result)),
		)
	}
	for scope, v := range snap.TLBFlushes {
		o.ObserveInt64(tlb, int64(v),
			metric.WithAttributes(attribute.String("scope", scope)),
		)
	}
	for typ, v := range snap.MMUEvents {
		o.ObserveInt64(mmu, int64(v),
			metric.WithAttributes(attribute.String("type", typ)),
		)
	}
	for size, v := range snap.Pages {
		o.ObserveInt64(pages, int64(v),
			metric.WithAttributes(attribute.String("system.kvm.page.size", size)),
		)
	}
}

// Close unregisters callbacks.
func (c *Collector) Close() {
	if c == nil {
		return
	}
	for _, r := range c.reg {
		_ = r.Unregister()
	}
}
