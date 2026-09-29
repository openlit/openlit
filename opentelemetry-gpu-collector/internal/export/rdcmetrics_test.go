package export

import (
	"log/slog"
	"testing"

	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/rdc"
)

func TestRDCMetricsFromFakeClient(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	fake := rdc.NewFakeClient(rdc.Sample{
		DeviceID:  "GPU-rdc-test",
		GPUID:     0,
		ParentID:  "GPU-parent-uuid",
		Partition: "xcd0",
		Values: map[string]float64{
			rdc.MetricOccupancy: 0.40,
			rdc.MetricPipeFP16:  0.25,
			rdc.MetricPipeFP32:  0.12,
			rdc.MetricPipeFP64:  0.02,
			rdc.MetricSIMDUtil:  0.65,
		},
	})

	dev := &mockDevice{
		info: gpu.DeviceInfo{
			Vendor: gpu.VendorAMD,
			Index:  0,
			Name:   "Test AMD GPU",
			UUID:   "GPU-rdc-test",
		},
		snapshot: &gpu.Snapshot{},
	}

	rm, err := NewRDCMetrics(provider, []gpu.Device{dev}, fake, slog.Default())
	if err != nil {
		t.Fatalf("NewRDCMetrics: %v", err)
	}
	defer rm.Close()

	var out metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &out); err != nil {
		t.Fatalf("Collect: %v", err)
	}

	reported := map[string]bool{}
	sourceOK := false
	parentOK := false
	for _, sm := range out.ScopeMetrics {
		if sm.Scope.Name != "otelcol.gpu.rdc" {
			continue
		}
		for _, m := range sm.Metrics {
			reported[m.Name] = true
			if data, ok := m.Data.(metricdata.Gauge[float64]); ok {
				for _, dp := range data.DataPoints {
					for _, kv := range dp.Attributes.ToSlice() {
						if string(kv.Key) == attrMeasurementSource && kv.Value.AsString() == sourceRDC {
							sourceOK = true
						}
						if string(kv.Key) == "hw.parent" && kv.Value.AsString() == "GPU-parent-uuid" {
							parentOK = true
						}
					}
				}
			}
		}
	}

	want := []string{
		"hw.gpu.sm.occupancy",
		"hw.gpu.pipe.utilization",
		"hw.gpu.simd.utilization",
	}
	for _, name := range want {
		if !reported[name] {
			t.Errorf("missing metric %q", name)
		}
	}
	if !sourceOK {
		t.Error("expected gpu.measurement.source=rdc")
	}
	if !parentOK {
		t.Error("expected hw.parent on partition sample")
	}
}

func TestRDCMetricsUnavailableClient(t *testing.T) {
	provider := metric.NewMeterProvider()
	defer provider.Shutdown(t.Context())
	_, err := NewRDCMetrics(provider, nil, rdc.UnavailableClient{}, slog.Default())
	if err == nil {
		t.Fatal("expected error for unavailable client")
	}
}
