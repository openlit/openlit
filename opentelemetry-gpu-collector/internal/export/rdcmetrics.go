package export

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/rdc"
)

const sourceRDC = "rdc"

// RDCMetrics exports AMD RDC profiling metrics as OTel instruments.
type RDCMetrics struct {
	client  rdc.Client
	devices []gpu.Device
	logger  *slog.Logger
	reg     []metric.Registration

	scrapeErrors metric.Int64Counter
	mu           sync.Mutex
}

// NewRDCMetrics registers RDC-backed observable gauges.
func NewRDCMetrics(
	provider *sdkmetric.MeterProvider,
	devices []gpu.Device,
	client rdc.Client,
	logger *slog.Logger,
) (*RDCMetrics, error) {
	if client == nil || !client.Available() {
		return nil, fmt.Errorf("rdc client unavailable")
	}
	if logger == nil {
		logger = slog.Default()
	}

	rm := &RDCMetrics{
		client:  client,
		devices: devices,
		logger:  logger,
	}

	meter := provider.Meter("otelcol.gpu.rdc",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	var err error
	rm.scrapeErrors, err = meter.Int64Counter("openlit.collector.gpu.scrape.errors",
		metric.WithDescription("GPU scrape errors from optional backends"),
		metric.WithUnit("{error}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating scrape errors counter: %w", err)
	}

	smUtil, err := meter.Float64ObservableGauge("hw.gpu.sm.utilization",
		metric.WithDescription("SM/CU active ratio from AMD RDC"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.sm.utilization: %w", err)
	}

	smOccupancy, err := meter.Float64ObservableGauge("hw.gpu.sm.occupancy",
		metric.WithDescription("SM/CU occupancy from AMD RDC"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.sm.occupancy: %w", err)
	}

	pipeUtil, err := meter.Float64ObservableGauge("hw.gpu.pipe.utilization",
		metric.WithDescription("GPU pipe utilization from RDC EVAL_FLOPS"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.pipe.utilization: %w", err)
	}

	simdUtil, err := meter.Float64ObservableGauge("hw.gpu.simd.utilization",
		metric.WithDescription("SIMD utilization from AMD RDC (extension)"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.simd.utilization: %w", err)
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			return rm.observe(ctx, o, smUtil, smOccupancy, pipeUtil, simdUtil)
		},
		smUtil, smOccupancy, pipeUtil, simdUtil,
	)
	if err != nil {
		return nil, fmt.Errorf("registering RDC callback: %w", err)
	}
	rm.reg = append(rm.reg, reg)
	return rm, nil
}

func (rm *RDCMetrics) observe(
	ctx context.Context,
	o metric.Observer,
	smUtil, smOccupancy, pipeUtil, simdUtil metric.Float64ObservableGauge,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	samples, err := rm.client.Sample()
	if err != nil {
		rm.recordScrapeError(errorTypeAPIError)
		rm.logger.Warn("RDC sample failed", "error", err)
		return nil
	}

	uuidByIndex := rm.uuidIndex()

	for _, s := range samples {
		hwID := s.DeviceID
		name := ""
		vendor := string(gpu.VendorAMD)
		idx := int(s.GPUID)
		var info gpu.DeviceInfo
		var haveInfo bool
		if di, ok := uuidByIndex[s.GPUID]; ok {
			info = di
			haveInfo = true
			if info.UUID != "" {
				hwID = info.UUID
			}
			name = info.Name
			vendor = string(info.Vendor)
			idx = info.Index
		}
		if hwID == "" {
			hwID = fmt.Sprintf("rdc-%d", s.GPUID)
		}

		base := []attribute.KeyValue{
			attribute.String("hw.id", hwID),
			attribute.String("hw.vendor", vendor),
			attribute.String("hw.type", "gpu"),
			attribute.Int("gpu.index", idx),
			attribute.String(attrMeasurementSource, sourceRDC),
		}
		if name != "" {
			base = append(base,
				attribute.String("hw.name", name),
				attribute.String("hw.model", name),
			)
		}
		if haveInfo && info.DriverVersion != "" {
			base = append(base, attribute.String("hw.driver_version", info.DriverVersion))
		}
		if s.ParentID != "" {
			base = append(base, attribute.String("hw.parent", s.ParentID))
		}
		if s.Partition != "" {
			base = append(base, attribute.String("hw.gpu.partition", s.Partition))
		}

		observeRatio := func(inst metric.Float64ObservableGauge, key string, extra ...attribute.KeyValue) {
			v, ok := s.Values[key]
			if !ok {
				return
			}
			attrs := base
			if len(extra) > 0 {
				attrs = append(append([]attribute.KeyValue{}, base...), extra...)
			}
			o.ObserveFloat64(inst, clamp01(v), metric.WithAttributeSet(attribute.NewSet(attrs...)))
		}

		observeRatio(smUtil, rdc.MetricSMActive)
		observeRatio(smOccupancy, rdc.MetricOccupancy)
		observeRatio(pipeUtil, rdc.MetricPipeFP16, attribute.String("hw.gpu.pipe", "fp16"))
		observeRatio(pipeUtil, rdc.MetricPipeFP32, attribute.String("hw.gpu.pipe", "fp32"))
		observeRatio(pipeUtil, rdc.MetricPipeFP64, attribute.String("hw.gpu.pipe", "fp64"))
		observeRatio(simdUtil, rdc.MetricSIMDUtil)
	}
	return nil
}

func (rm *RDCMetrics) uuidIndex() map[uint]gpu.DeviceInfo {
	out := make(map[uint]gpu.DeviceInfo, len(rm.devices))
	for _, d := range rm.devices {
		info := d.Info()
		if info.Vendor != gpu.VendorAMD {
			continue
		}
		out[uint(info.Index)] = info
	}
	return out
}

func (rm *RDCMetrics) recordScrapeError(errType string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.scrapeErrors == nil {
		return
	}
	rm.scrapeErrors.Add(context.Background(), 1,
		metric.WithAttributes(
			attribute.String(attrMeasurementSource, sourceRDC),
			attribute.String("error.type", errType),
		),
	)
}

// Close unregisters callbacks. Does not close the RDC client.
func (rm *RDCMetrics) Close() {
	if rm == nil {
		return
	}
	for _, r := range rm.reg {
		_ = r.Unregister()
	}
	rm.reg = nil
}
