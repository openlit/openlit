package tpu

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
)

// Collector scrapes TPU Prometheus metrics and emits hw.tpu.*.
type Collector struct {
	logger  *slog.Logger
	scraper *Scraper
	reg     []metric.Registration
	errors  atomic.Int64

	consecutiveFails atomic.Int64
	disabled         atomic.Bool
}

const tpuMaxConsecutiveFails = 3

// scrapeFunc is overridable in tests.
type scrapeFunc func() ([]Sample, error)

// NewCollector registers TPU instruments and an observable callback.
func NewCollector(provider *sdkmetric.MeterProvider, cfg *config.Config, logger *slog.Logger) (*Collector, error) {
	if logger == nil {
		logger = slog.Default()
	}
	scraper := NewScraper(cfg.TPUEndpoint, cfg.TPUScrapeTimeoutMS, cfg.TPUMetricAllowlist)
	c, err := newCollector(provider, scraper.Scrape, logger)
	if err != nil {
		return nil, err
	}
	c.scraper = scraper
	return c, nil
}

func newCollector(provider *sdkmetric.MeterProvider, scrape scrapeFunc, logger *slog.Logger) (*Collector, error) {
	c := &Collector{logger: logger}

	meter := provider.Meter("otelcol.tpu",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	util, err := meter.Float64ObservableGauge("hw.tpu.utilization",
		metric.WithDescription("TPU duty cycle as a fraction"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.tpu.utilization: %w", err)
	}

	tcUtil, err := meter.Float64ObservableGauge("hw.tpu.tensorcore.utilization",
		metric.WithDescription("TPU tensorcore utilization as a fraction"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.tpu.tensorcore.utilization: %w", err)
	}

	memLimit, err := meter.Int64ObservableUpDownCounter("hw.tpu.memory.limit",
		metric.WithDescription("TPU memory limit in bytes"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.tpu.memory.limit: %w", err)
	}

	memUsage, err := meter.Int64ObservableUpDownCounter("hw.tpu.memory.usage",
		metric.WithDescription("TPU memory usage in bytes"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.tpu.memory.usage: %w", err)
	}

	memUtil, err := meter.Float64ObservableGauge("hw.tpu.memory.utilization",
		metric.WithDescription("TPU memory utilization as a fraction"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.tpu.memory.utilization: %w", err)
	}

	memBWUtil, err := meter.Float64ObservableGauge("hw.tpu.memory.bandwidth.utilization",
		metric.WithDescription("TPU memory bandwidth utilization as a fraction"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.tpu.memory.bandwidth.utilization: %w", err)
	}

	scrapeErrs, err := meter.Int64ObservableCounter("openlit.collector.tpu.scrape.errors",
		metric.WithDescription("TPU Prometheus scrape errors"),
		metric.WithUnit("{error}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating openlit.collector.tpu.scrape.errors: %w", err)
	}

	// Track last successful memory for utilization derivation.
	type memPair struct {
		limit, used float64
		attrs       []attribute.KeyValue
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			if c.disabled.Load() {
				o.ObserveInt64(scrapeErrs, c.errors.Load())
				return nil
			}
			samples, err := scrape()
			if err != nil {
				c.errors.Add(1)
				fails := c.consecutiveFails.Add(1)
				c.logger.Debug("tpu scrape error", "error", err, "consecutive", fails)
				if fails >= tpuMaxConsecutiveFails && c.disabled.CompareAndSwap(false, true) {
					c.logger.Warn("TPU scrape disabled after consecutive failures; set OTEL_TPU_ENABLED=false or fix OTEL_TPU_ENDPOINT",
						"failures", fails,
					)
				}
				o.ObserveInt64(scrapeErrs, c.errors.Load())
				return nil
			}
			c.consecutiveFails.Store(0)
			o.ObserveInt64(scrapeErrs, c.errors.Load())

			memByID := map[string]*memPair{}

			for _, s := range samples {
				attrs := sampleAttrs(s.Labels)
				attrOpt := metric.WithAttributes(attrs...)
				switch {
				case strings.HasPrefix(s.Name, "duty_cycle"):
					o.ObserveFloat64(util, percentToFraction(s.Value), attrOpt)
				case strings.HasPrefix(s.Name, "tensorcore_utilization"):
					o.ObserveFloat64(tcUtil, percentToFraction(s.Value), attrOpt)
				case strings.HasPrefix(s.Name, "memory_total"):
					o.ObserveInt64(memLimit, int64(s.Value), attrOpt)
					id := s.Labels["accelerator_id"]
					p := memByID[id]
					if p == nil {
						p = &memPair{attrs: attrs}
						memByID[id] = p
					}
					p.limit = s.Value
					p.attrs = attrs
				case strings.HasPrefix(s.Name, "memory_used"):
					o.ObserveInt64(memUsage, int64(s.Value), attrOpt)
					id := s.Labels["accelerator_id"]
					p := memByID[id]
					if p == nil {
						p = &memPair{attrs: attrs}
						memByID[id] = p
					}
					p.used = s.Value
					if len(p.attrs) == 0 {
						p.attrs = attrs
					}
				case strings.HasPrefix(s.Name, "memory_bandwidth_utilization"):
					o.ObserveFloat64(memBWUtil, percentToFraction(s.Value), attrOpt)
				}
			}
			for _, p := range memByID {
				if p.limit > 0 {
					o.ObserveFloat64(memUtil, p.used/p.limit, metric.WithAttributes(p.attrs...))
				}
			}
			return nil
		},
		util, tcUtil, memLimit, memUsage, memUtil, memBWUtil, scrapeErrs,
	)
	if err != nil {
		return nil, fmt.Errorf("registering tpu callback: %w", err)
	}
	c.reg = append(c.reg, reg)
	logger.Info("TPU metrics collector initialized")
	return c, nil
}

// Close unregisters callbacks.
func (c *Collector) Close() {
	for _, r := range c.reg {
		_ = r.Unregister()
	}
}

func sampleAttrs(labels map[string]string) []attribute.KeyValue {
	attrs := []attribute.KeyValue{
		attribute.String("hw.type", "tpu"),
	}
	if id := labels["accelerator_id"]; id != "" {
		// Namespace hw.id so TPU and GPU UUIDs never collide in joins.
		attrs = append(attrs,
			attribute.String("hw.id", "tpu:"+id),
			attribute.String("hw.tpu.accelerator_id", id),
		)
	}
	if model := labels["model"]; model != "" {
		attrs = append(attrs, attribute.String("hw.model", model))
	}
	if vendor := labels["make"]; vendor != "" {
		attrs = append(attrs, attribute.String("hw.vendor", vendor))
	}
	if ns := labels["namespace"]; ns != "" {
		attrs = append(attrs, attribute.String("k8s.namespace.name", ns))
	}
	if pod := labels["pod"]; pod != "" {
		attrs = append(attrs, attribute.String("k8s.pod.name", pod))
	}
	if c := labels["container"]; c != "" {
		attrs = append(attrs, attribute.String("k8s.container.name", c))
	}
	if topo := labels["tpu_topology"]; topo != "" {
		attrs = append(attrs, attribute.String("tpu.topology", topo))
	}
	return attrs
}

func percentToFraction(v float64) float64 {
	// Plugin exposes 0–100 percentages; also accept already-normalized fractions.
	if v > 1.0 {
		return v / 100.0
	}
	return v
}
