package export

import (
	"log/slog"
	"testing"

	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

// requiredSpecMetrics lists core OTel hardware GPU instruments that must be
// present when a mock device reports a full snapshot.
var requiredSpecMetrics = []struct {
	Name string
	Unit string
}{
	{"hw.gpu.utilization", "1"},
	{"hw.gpu.memory.utilization", "1"},
	{"hw.gpu.memory.controller.utilization", "1"},
	{"hw.gpu.memory.limit", "By"},
	{"hw.gpu.memory.usage", "By"},
	{"hw.gpu.memory.free", "By"},
	{"hw.power", "W"},
	{"hw.power.limit", "W"},
	{"hw.energy", "J"},
	{"hw.temperature", "Cel"},
	{"hw.fan.speed", "rpm"},
	{"hw.fan.speed_ratio", "1"},
	{"hw.gpu.speed", "Hz"},
	{"hw.gpu.io", "By"},
	{"hw.status", "1"},
	{"hw.errors", "{error}"},
	{"hw.gpu.allocated", "1"},
	{"hw.gpu.idle", "1"},
}

func TestSemconvCoreGPUMetrics(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	dev := &mockDevice{
		info: gpu.DeviceInfo{
			Vendor:     gpu.VendorNVIDIA,
			Index:      0,
			Name:       "Semconv Test GPU",
			UUID:       "GPU-semconv-test",
			PCIAddress: "0000:01:00.0",
		},
		snapshot: &gpu.Snapshot{
			Utilization:       ptr(75.0),
			MemoryUtilization: ptr(50.0),
			TemperatureGPU:    ptr(68.0),
			FanSpeedRPM:       ptr(2100.0),
			FanSpeedRatio:     ptr(0.42),
			MemoryTotalBytes:  ptr(int64(16 << 30)),
			MemoryUsedBytes:   ptr(int64(8 << 30)),
			MemoryFreeBytes:   ptr(int64(8 << 30)),
			PowerDrawWatts:    ptr(200.0),
			PowerLimitWatts:   ptr(300.0),
			EnergyJoules:      ptr(999.0),
			ClockGraphicsMHz:  ptr(1500.0),
			ClockMemoryMHz:    ptr(5000.0),
			PCIeRxBytesTotal:  ptr(int64(1000)),
			PCIeTxBytesTotal:  ptr(int64(2000)),
			ECCSingleBit:      ptr(int64(0)),
			ECCDoubleBit:      ptr(int64(0)),
			Throttled:         ptr(0.0),
		},
	}

	mc, err := NewMetricsCollector(provider, []gpu.Device{dev}, slog.Default(), testConfig())
	if err != nil {
		t.Fatalf("NewMetricsCollector: %v", err)
	}
	defer mc.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}

	type metricMeta struct {
		present bool
		unit    string
	}
	got := map[string]metricMeta{}
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name != "otelcol.gpu.collector" {
			continue
		}
		for _, m := range sm.Metrics {
			got[m.Name] = metricMeta{present: true, unit: m.Unit}
		}
	}

	for _, want := range requiredSpecMetrics {
		meta, ok := got[want.Name]
		if !ok || !meta.present {
			t.Errorf("required spec metric %q missing", want.Name)
			continue
		}
		if meta.unit != want.Unit {
			t.Errorf("metric %q unit = %q, want %q", want.Name, meta.unit, want.Unit)
		}
	}

	// Spec: hw.gpu.memory.utilization is usage/limit, not controller busy.
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name != "otelcol.gpu.collector" {
			continue
		}
		for _, m := range sm.Metrics {
			if m.Name != "hw.gpu.memory.utilization" {
				continue
			}
			gauge := m.Data.(metricdata.Gauge[float64])
			if len(gauge.DataPoints) != 1 || gauge.DataPoints[0].Value != 0.5 {
				t.Fatalf("hw.gpu.memory.utilization = %#v, want 0.5 (8/16 GiB)", gauge.DataPoints)
			}
		}
	}
}

func TestSemconvStatusStateSet(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	dev := &mockDevice{
		info: gpu.DeviceInfo{Vendor: gpu.VendorNVIDIA, UUID: "GPU-status", Index: 0, Name: "T"},
		snapshot: &gpu.Snapshot{
			Utilization: ptr(10.0),
			Throttled:   ptr(1.0),
		},
	}
	mc, err := NewMetricsCollector(provider, []gpu.Device{dev}, slog.Default(), testConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer mc.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatal(err)
	}
	states := map[string]int64{}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != "hw.status" {
				continue
			}
			sum := m.Data.(metricdata.Sum[int64])
			for _, dp := range sum.DataPoints {
				st := ""
				hasType := false
				for _, kv := range dp.Attributes.ToSlice() {
					if string(kv.Key) == "hw.state" {
						st = kv.Value.AsString()
					}
					if string(kv.Key) == "hw.type" && kv.Value.AsString() == "gpu" {
						hasType = true
					}
				}
				if !hasType {
					t.Fatal("hw.status missing hw.type=gpu")
				}
				states[st] = dp.Value
			}
		}
	}
	if states["ok"] != 0 || states["degraded"] != 1 || states["failed"] != 0 {
		t.Fatalf("status states = %#v, want ok=0 degraded=1 failed=0", states)
	}
}
