package export

import (
	"log/slog"
	"testing"

	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/dcgm"
)

func TestDCGMMetricsPreferEmitsOverlap(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	fake := dcgm.NewFakeClient(dcgm.Sample{
		DeviceID: "GPU-dcgm-test",
		GPUID:    0,
		Values: map[string]float64{
			dcgm.MetricEngineUtil:   0.42,
			dcgm.MetricSMUtil:       0.55,
			dcgm.MetricSMOccupancy:  0.33,
			dcgm.MetricPipeTensor:   0.21,
			dcgm.MetricPipeFP64:     0.01,
			dcgm.MetricPipeFP32:     0.10,
			dcgm.MetricPipeFP16:     0.15,
			dcgm.MetricMemBWUtil:    0.70,
			dcgm.MetricSMClockMHz:   1500,
			dcgm.MetricPowerWatts:   250,
			dcgm.MetricGPUUtilPct:   80,
			dcgm.MetricMemCopyUtil:  40,
			dcgm.MetricPCIeTxRate:   1e6,
			dcgm.MetricPCIeRxRate:   2e6,
			dcgm.MetricNVLinkTxRate: 3e6,
			dcgm.MetricNVLinkRxRate: 4e6,
		},
	})

	dev := &mockDevice{
		info: gpu.DeviceInfo{
			Vendor:     gpu.VendorNVIDIA,
			Index:      0,
			Name:       "Test GPU",
			UUID:       "GPU-dcgm-test",
			PCIAddress: "0000:01:00.0",
		},
		snapshot: &gpu.Snapshot{},
	}

	cfg := &config.Config{
		DCGMPrefer:          true,
		InterconnectEnabled: true,
	}
	dm, err := NewDCGMMetrics(provider, []gpu.Device{dev}, fake, cfg, slog.Default(), nil)
	if err != nil {
		t.Fatalf("NewDCGMMetrics: %v", err)
	}
	defer dm.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}

	reported := map[string]bool{}
	sourceOK := false
	pciOK := false
	graphicsClockOK := false
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name != "otelcol.gpu.dcgm" {
			continue
		}
		for _, m := range sm.Metrics {
			reported[m.Name] = true
			switch data := m.Data.(type) {
			case metricdata.Gauge[float64]:
				for _, dp := range data.DataPoints {
					for _, kv := range dp.Attributes.ToSlice() {
						if string(kv.Key) == attrMeasurementSource && kv.Value.AsString() == sourceDCGM {
							sourceOK = true
						}
						if string(kv.Key) == "gpu.pci_address" && kv.Value.AsString() == "0000:01:00.0" {
							pciOK = true
						}
						if m.Name == "hw.gpu.speed" && string(kv.Key) == "hw.gpu.clock_domain" && kv.Value.AsString() == "graphics" {
							graphicsClockOK = true
						}
					}
				}
			case metricdata.Sum[int64]:
				for _, dp := range data.DataPoints {
					for _, kv := range dp.Attributes.ToSlice() {
						if string(kv.Key) == attrMeasurementSource && kv.Value.AsString() == sourceDCGM {
							sourceOK = true
						}
					}
				}
			case metricdata.Sum[float64]:
				t.Errorf("unexpected float64 sum for %s (IO should be int64)", m.Name)
			}
		}
	}

	want := []string{
		"hw.gpu.engine.utilization",
		"hw.gpu.sm.utilization",
		"hw.gpu.sm.occupancy",
		"hw.gpu.pipe.utilization",
		"hw.gpu.memory.bandwidth.utilization",
		"hw.gpu.speed",
		"hw.power",
		"hw.gpu.utilization",
		"hw.gpu.idle",
		"hw.gpu.memory.controller.utilization",
		"openlit.collector.gpu.dcgm.sample_valid",
	}
	for _, name := range want {
		if !reported[name] {
			t.Errorf("missing metric %q", name)
		}
	}
	if !sourceOK {
		t.Error("expected gpu.measurement.source=dcgm on observations")
	}
	if !pciOK {
		t.Error("expected gpu.pci_address on DCGM observations for correlation")
	}
	if !graphicsClockOK {
		t.Error("expected Prefer hw.gpu.speed with clock_domain=graphics")
	}
}

func TestDCGMMetricsWithoutPreferSkipsOverlap(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	fake := dcgm.NewFakeClient(dcgm.Sample{
		DeviceID: "GPU-dcgm-test",
		GPUID:    0,
		Values: map[string]float64{
			dcgm.MetricSMUtil:     0.55,
			dcgm.MetricPCIeTxRate: 1e6,
			dcgm.MetricSMClockMHz: 1500,
			dcgm.MetricPowerWatts: 200,
		},
	})

	dev := &mockDevice{
		info: gpu.DeviceInfo{
			Vendor: gpu.VendorNVIDIA,
			Index:  0,
			UUID:   "GPU-dcgm-test",
		},
		snapshot: &gpu.Snapshot{},
	}

	dm, err := NewDCGMMetrics(provider, []gpu.Device{dev}, fake, &config.Config{DCGMPrefer: false}, slog.Default(), nil)
	if err != nil {
		t.Fatalf("NewDCGMMetrics: %v", err)
	}
	defer dm.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}

	reported := map[string]bool{}
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name != "otelcol.gpu.dcgm" {
			continue
		}
		for _, m := range sm.Metrics {
			reported[m.Name] = true
		}
	}

	if !reported["hw.gpu.sm.utilization"] {
		t.Error("expected DCP-only sm.utilization")
	}
	for _, name := range []string{
		"hw.gpu.io", "hw.gpu.speed", "hw.power", "hw.gpu.utilization",
		"hw.gpu.memory.controller.utilization",
	} {
		if reported[name] {
			t.Errorf("without Prefer, should not emit overlapping %q", name)
		}
	}
}

func TestDCGMMetricsUnavailableClient(t *testing.T) {
	provider := metric.NewMeterProvider()
	defer provider.Shutdown(t.Context())
	_, err := NewDCGMMetrics(provider, nil, dcgm.UnavailableClient{}, &config.Config{}, slog.Default(), nil)
	if err == nil {
		t.Fatal("expected error for unavailable client")
	}
}
