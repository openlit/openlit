package export

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/dcgm"
)

const (
	attrMeasurementSource = "gpu.measurement.source"
	sourceDCGM            = "dcgm"

	errorTypeBlankSample = "blank_sample"
	errorTypeAPIError    = "api_error"
)

// DCGMMetrics exports DCGM profiling metrics as OTel instruments.
type DCGMMetrics struct {
	client     dcgm.Client
	devices    []gpu.Device
	logger     *slog.Logger
	cfg        *config.Config
	preferGate *PreferGate
	reg        []metric.Registration

	scrapeErrors metric.Int64Counter

	mu           sync.Mutex
	ioByGPU      map[uint]*dcgmIOAccum
	lastSampleAt time.Time
}

type dcgmIOAccum struct {
	pcieTx, pcieRx float64
	nvTx, nvRx     float64
	lastAt         time.Time
}

// NewDCGMMetrics registers DCGM-backed observable gauges/counters.
// preferGate may be nil; when set and DCGMPrefer is on, it coordinates NVML overlap suppression.
func NewDCGMMetrics(
	provider *sdkmetric.MeterProvider,
	devices []gpu.Device,
	client dcgm.Client,
	cfg *config.Config,
	logger *slog.Logger,
	preferGate *PreferGate,
) (*DCGMMetrics, error) {
	if client == nil || !client.Available() {
		return nil, fmt.Errorf("dcgm client unavailable")
	}
	if cfg == nil {
		cfg = config.Load()
	}
	if logger == nil {
		logger = slog.Default()
	}

	dm := &DCGMMetrics{
		client:     client,
		devices:    devices,
		logger:     logger,
		cfg:        cfg,
		preferGate: preferGate,
		ioByGPU:    make(map[uint]*dcgmIOAccum),
	}

	meter := provider.Meter("otelcol.gpu.dcgm",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	var err error
	dm.scrapeErrors, err = meter.Int64Counter("openlit.collector.gpu.scrape.errors",
		metric.WithDescription("GPU scrape errors from optional backends"),
		metric.WithUnit("{error}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating scrape errors counter: %w", err)
	}

	engineUtil, err := meter.Float64ObservableGauge("hw.gpu.engine.utilization",
		metric.WithDescription("GPU engine utilization from DCGM profiling"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.engine.utilization: %w", err)
	}

	smUtil, err := meter.Float64ObservableGauge("hw.gpu.sm.utilization",
		metric.WithDescription("SM active ratio from DCGM profiling"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.sm.utilization: %w", err)
	}

	smOccupancy, err := meter.Float64ObservableGauge("hw.gpu.sm.occupancy",
		metric.WithDescription("SM occupancy from DCGM profiling"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.sm.occupancy: %w", err)
	}

	pipeUtil, err := meter.Float64ObservableGauge("hw.gpu.pipe.utilization",
		metric.WithDescription("GPU pipe utilization from DCGM profiling"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.pipe.utilization: %w", err)
	}

	memBWUtil, err := meter.Float64ObservableGauge("hw.gpu.memory.bandwidth.utilization",
		metric.WithDescription("GPU memory bandwidth utilization from DCGM"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.gpu.memory.bandwidth.utilization: %w", err)
	}

	// Overlapping series (IO / speed / power / util) are only registered when
	// DCGMPrefer is set so NVML remains the sole producer otherwise.
	prefer := cfg.DCGMPrefer

	var (
		gpuIO             metric.Int64ObservableCounter
		interconnectIO    metric.Int64ObservableCounter
		gpuSpeed          metric.Float64ObservableGauge
		hwPower           metric.Float64ObservableGauge
		gpuUtil           metric.Float64ObservableGauge
		gpuIdle           metric.Float64ObservableGauge
		memControllerUtil metric.Float64ObservableGauge
		sampleValid       metric.Int64ObservableUpDownCounter
	)

	sampleValid, err = meter.Int64ObservableUpDownCounter("openlit.collector.gpu.dcgm.sample_valid",
		metric.WithDescription("1 when the latest DCGM sample for a GPU is non-blank; 0 on blank"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating openlit.collector.gpu.dcgm.sample_valid: %w", err)
	}

	observables := []metric.Observable{
		engineUtil, smUtil, smOccupancy, pipeUtil, memBWUtil, sampleValid,
	}

	if prefer {
		gpuIO, err = meter.Int64ObservableCounter("hw.gpu.io",
			metric.WithDescription("Cumulative PCIe bytes from DCGM rate integration"),
			metric.WithUnit("By"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating hw.gpu.io: %w", err)
		}
		interconnectIO, err = meter.Int64ObservableCounter("hw.gpu.interconnect.io",
			metric.WithDescription("Cumulative interconnect bytes from DCGM rate integration"),
			metric.WithUnit("By"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating hw.gpu.interconnect.io: %w", err)
		}
		gpuSpeed, err = meter.Float64ObservableGauge("hw.gpu.speed",
			metric.WithDescription("GPU clock speed from DCGM (Prefer; clock_domain=graphics from field 100)"),
			metric.WithUnit("Hz"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating hw.gpu.speed: %w", err)
		}
		hwPower, err = meter.Float64ObservableGauge("hw.power",
			metric.WithDescription("GPU power draw from DCGM"),
			metric.WithUnit("W"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating hw.power: %w", err)
		}
		gpuUtil, err = meter.Float64ObservableGauge("hw.gpu.utilization",
			metric.WithDescription("GPU utilization from DCGM_FI_DEV_GPU_UTIL"),
			metric.WithUnit("1"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating hw.gpu.utilization: %w", err)
		}
		gpuIdle, err = meter.Float64ObservableGauge("hw.gpu.idle",
			metric.WithDescription("GPU idle ratio derived from DCGM Prefer utilization"),
			metric.WithUnit("1"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating hw.gpu.idle: %w", err)
		}
		memControllerUtil, err = meter.Float64ObservableGauge("hw.gpu.memory.controller.utilization",
			metric.WithDescription("GPU memory copy/controller utilization from DCGM (extension)"),
			metric.WithUnit("1"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating hw.gpu.memory.controller.utilization: %w", err)
		}
		observables = append(observables, gpuIO, interconnectIO, gpuSpeed, hwPower, gpuUtil, gpuIdle, memControllerUtil)
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			return dm.observe(ctx, o, engineUtil, smUtil, smOccupancy, pipeUtil, memBWUtil,
				gpuIO, interconnectIO, gpuSpeed, hwPower, gpuUtil, gpuIdle, memControllerUtil, sampleValid)
		},
		observables...,
	)
	if err != nil {
		return nil, fmt.Errorf("registering DCGM callback: %w", err)
	}
	dm.reg = append(dm.reg, reg)
	return dm, nil
}

func (dm *DCGMMetrics) observe(
	ctx context.Context,
	o metric.Observer,
	engineUtil, smUtil, smOccupancy, pipeUtil, memBWUtil metric.Float64ObservableGauge,
	gpuIO, interconnectIO metric.Int64ObservableCounter,
	gpuSpeed, hwPower, gpuUtil, gpuIdle, memControllerUtil metric.Float64ObservableGauge,
	sampleValid metric.Int64ObservableUpDownCounter,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	samples, err := dm.client.Sample()
	if err != nil {
		dm.recordScrapeError(errorTypeAPIError)
		dm.logger.Warn("DCGM sample failed", "error", err)
		return nil
	}

	now := time.Now()
	uuidByIndex := dm.uuidIndex()
	prefer := dm.cfg != nil && dm.cfg.DCGMPrefer

	dm.mu.Lock()
	defer dm.mu.Unlock()

	for _, s := range samples {
		if s.Blank {
			dm.recordScrapeErrorLocked(errorTypeBlankSample)
		}

		hwID := s.DeviceID
		info, haveInfo := uuidByIndex[s.GPUID]
		if haveInfo && info.UUID != "" {
			hwID = info.UUID
		} else if hwID == "" || isDCGMFallbackID(hwID) {
			if haveInfo && info.UUID != "" {
				hwID = info.UUID
			}
		}
		name := ""
		vendor := string(gpu.VendorNVIDIA)
		idx := int(s.GPUID)
		pci := ""
		if haveInfo {
			name = info.Name
			vendor = string(info.Vendor)
			idx = info.Index
			pci = info.PCIAddress
		}

		base := []attribute.KeyValue{
			attribute.String("hw.id", hwID),
			attribute.String("hw.vendor", vendor),
			attribute.String("hw.type", "gpu"),
			attribute.Int("gpu.index", idx),
			attribute.String(attrMeasurementSource, sourceDCGM),
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
		if pci != "" {
			base = append(base, attribute.String("gpu.pci_address", pci))
		}

		valid := int64(1)
		if s.Blank {
			valid = 0
		}
		o.ObserveInt64(sampleValid, valid, metric.WithAttributeSet(attribute.NewSet(base...)))

		if prefer {
			dm.preferGate.NoteSample(hwID, !s.Blank)
		}

		observeRatio := func(inst metric.Float64ObservableGauge, key string, extra ...attribute.KeyValue) {
			if inst == nil {
				return
			}
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

		// DCP-only series: always emitted (no NVML equivalent).
		observeRatio(engineUtil, dcgm.MetricEngineUtil, attribute.String("hw.gpu.engine", "graphics"))
		observeRatio(smUtil, dcgm.MetricSMUtil)
		observeRatio(smOccupancy, dcgm.MetricSMOccupancy)
		observeRatio(memBWUtil, dcgm.MetricMemBWUtil)
		observeRatio(pipeUtil, dcgm.MetricPipeTensor, attribute.String("hw.gpu.pipe", "tensor"))
		observeRatio(pipeUtil, dcgm.MetricPipeFP64, attribute.String("hw.gpu.pipe", "fp64"))
		observeRatio(pipeUtil, dcgm.MetricPipeFP32, attribute.String("hw.gpu.pipe", "fp32"))
		observeRatio(pipeUtil, dcgm.MetricPipeFP16, attribute.String("hw.gpu.pipe", "fp16"))

		if !prefer || s.Blank {
			// Blank Prefer samples skip overlap series so NVML can fill via PreferGate.
			continue
		}

		// Prefer mode: DCGM owns overlapping series; NVML path suppresses them.
		// Field 100 (SM clock) is labeled clock_domain=graphics so Prefer keeps
		// the same series identity as NVML graphics (dashboards do not split).
		if mhz, ok := s.Values[dcgm.MetricSMClockMHz]; ok && gpuSpeed != nil {
			speedAttrs := attribute.NewSet(append(append([]attribute.KeyValue{}, base...),
				attribute.String("hw.gpu.clock_domain", "graphics"),
			)...)
			o.ObserveFloat64(gpuSpeed, mhz*1e6, metric.WithAttributeSet(speedAttrs))
		}
		if watts, ok := s.Values[dcgm.MetricPowerWatts]; ok && hwPower != nil {
			o.ObserveFloat64(hwPower, watts, metric.WithAttributeSet(attribute.NewSet(base...)))
		}
		if pct, ok := s.Values[dcgm.MetricGPUUtilPct]; ok && gpuUtil != nil {
			utilAttrs := attribute.NewSet(append(append([]attribute.KeyValue{}, base...),
				attribute.String("hw.gpu.task", "general"),
			)...)
			ratio := clamp01(pct / 100.0)
			o.ObserveFloat64(gpuUtil, ratio, metric.WithAttributeSet(utilAttrs))
			if gpuIdle != nil {
				o.ObserveFloat64(gpuIdle, 1.0-ratio, metric.WithAttributeSet(attribute.NewSet(base...)))
			}
		}
		if pct, ok := s.Values[dcgm.MetricMemCopyUtil]; ok && memControllerUtil != nil {
			o.ObserveFloat64(memControllerUtil, clamp01(pct/100.0), metric.WithAttributeSet(attribute.NewSet(base...)))
		}

		accum := dm.ioByGPU[s.GPUID]
		if accum == nil {
			accum = &dcgmIOAccum{lastAt: now}
			dm.ioByGPU[s.GPUID] = accum
		}
		dt := now.Sub(accum.lastAt).Seconds()
		if dt < 0 {
			dt = 0
		}
		if dt > 0 {
			if rate, ok := s.Values[dcgm.MetricPCIeTxRate]; ok {
				accum.pcieTx += rate * dt
			}
			if rate, ok := s.Values[dcgm.MetricPCIeRxRate]; ok {
				accum.pcieRx += rate * dt
			}
			if rate, ok := s.Values[dcgm.MetricNVLinkTxRate]; ok {
				accum.nvTx += rate * dt
			}
			if rate, ok := s.Values[dcgm.MetricNVLinkRxRate]; ok {
				accum.nvRx += rate * dt
			}
		}
		accum.lastAt = now

		if gpuIO != nil {
			if accum.pcieRx > 0 || hasKey(s, dcgm.MetricPCIeRxRate) {
				rx := attribute.NewSet(append(append([]attribute.KeyValue{}, base...),
					attribute.String("network.io.direction", "receive"),
				)...)
				o.ObserveInt64(gpuIO, int64(accum.pcieRx), metric.WithAttributeSet(rx))
			}
			if accum.pcieTx > 0 || hasKey(s, dcgm.MetricPCIeTxRate) {
				tx := attribute.NewSet(append(append([]attribute.KeyValue{}, base...),
					attribute.String("network.io.direction", "transmit"),
				)...)
				o.ObserveInt64(gpuIO, int64(accum.pcieTx), metric.WithAttributeSet(tx))
			}
		}
		if interconnectIO != nil && dm.cfg.InterconnectEnabled {
			if accum.nvRx > 0 || hasKey(s, dcgm.MetricNVLinkRxRate) {
				rx := attribute.NewSet(append(append([]attribute.KeyValue{}, base...),
					attribute.String("network.io.direction", "receive"),
					attribute.String("hw.gpu.interconnect.type", "nvlink"),
				)...)
				o.ObserveInt64(interconnectIO, int64(accum.nvRx), metric.WithAttributeSet(rx))
			}
			if accum.nvTx > 0 || hasKey(s, dcgm.MetricNVLinkTxRate) {
				tx := attribute.NewSet(append(append([]attribute.KeyValue{}, base...),
					attribute.String("network.io.direction", "transmit"),
					attribute.String("hw.gpu.interconnect.type", "nvlink"),
				)...)
				o.ObserveInt64(interconnectIO, int64(accum.nvTx), metric.WithAttributeSet(tx))
			}
		}
	}

	dm.lastSampleAt = now
	return nil
}

func hasKey(s dcgm.Sample, key string) bool {
	_, ok := s.Values[key]
	return ok
}

func isDCGMFallbackID(id string) bool {
	return strings.HasPrefix(id, "dcgm-")
}

func (dm *DCGMMetrics) uuidIndex() map[uint]gpu.DeviceInfo {
	out := make(map[uint]gpu.DeviceInfo, len(dm.devices))
	for _, d := range dm.devices {
		info := d.Info()
		if info.Vendor != gpu.VendorNVIDIA {
			continue
		}
		// Prefer matching by device index; also key by DCGM-style ordinal.
		out[uint(info.Index)] = info
	}
	return out
}

func (dm *DCGMMetrics) recordScrapeError(errType string) {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	dm.recordScrapeErrorLocked(errType)
}

func (dm *DCGMMetrics) recordScrapeErrorLocked(errType string) {
	if dm.scrapeErrors == nil {
		return
	}
	dm.scrapeErrors.Add(context.Background(), 1,
		metric.WithAttributes(
			attribute.String(attrMeasurementSource, sourceDCGM),
			attribute.String("error.type", errType),
		),
	)
}

// PauseProfiling pauses DCGM profiling for duration (for Kineto/control RPC).
func (dm *DCGMMetrics) PauseProfiling(duration time.Duration) error {
	if dm == nil || dm.client == nil {
		return nil
	}
	return dm.client.PauseProfiling(duration)
}

// ResumeProfiling resumes DCGM profiling.
func (dm *DCGMMetrics) ResumeProfiling() error {
	if dm == nil || dm.client == nil {
		return nil
	}
	return dm.client.ResumeProfiling()
}

// Close unregisters callbacks. Does not close the DCGM client.
func (dm *DCGMMetrics) Close() {
	if dm == nil {
		return
	}
	for _, r := range dm.reg {
		_ = r.Unregister()
	}
	dm.reg = nil
}
