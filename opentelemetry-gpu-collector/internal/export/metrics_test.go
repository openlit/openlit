package export

import (
	"log/slog"
	"testing"

	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

// mockDevice implements gpu.Device for testing without real hardware.
type mockDevice struct {
	info     gpu.DeviceInfo
	snapshot *gpu.Snapshot
	err      error
}

func (m *mockDevice) Info() gpu.DeviceInfo    { return m.info }
func (m *mockDevice) Collect() (*gpu.Snapshot, error) { return m.snapshot, m.err }
func (m *mockDevice) Close()                  {}

func ptr[T any](v T) *T { return &v }

func TestNewMetricsCollectorRegisters(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	dev := &mockDevice{
		info: gpu.DeviceInfo{
			Vendor:     gpu.VendorNVIDIA,
			Index:      0,
			Name:       "Test GPU",
			UUID:       "GPU-test-uuid-0000",
			PCIAddress: "0000:01:00.0",
		},
		snapshot: &gpu.Snapshot{
			Utilization:        ptr(80.0),
			EncoderUtilization: ptr(10.0),
			DecoderUtilization: ptr(5.0),
			MemoryUtilization:  ptr(60.0),
			TemperatureGPU:     ptr(70.0),
			MemoryTotalBytes:   ptr(int64(8 * 1024 * 1024 * 1024)),
			MemoryUsedBytes:    ptr(int64(4 * 1024 * 1024 * 1024)),
			MemoryFreeBytes:    ptr(int64(4 * 1024 * 1024 * 1024)),
			PowerDrawWatts:     ptr(150.0),
			PowerLimitWatts:    ptr(250.0),
			EnergyJoules:       ptr(12345.0),
			ClockGraphicsMHz:   ptr(1800.0),
			ClockMemoryMHz:     ptr(9000.0),
			PCIeReplayErrors:   ptr(int64(0)),
			ECCSingleBit:       ptr(int64(0)),
			ECCDoubleBit:       ptr(int64(0)),
		},
	}

	logger := slog.Default()
	mc, err := NewMetricsCollector(provider, []gpu.Device{dev}, logger)
	if err != nil {
		t.Fatalf("NewMetricsCollector() error = %v", err)
	}
	defer mc.Close()

	// Trigger a collection by gathering metrics.
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("reader.Collect() error = %v", err)
	}

	// Find the scope metrics for our collector.
	var scopeMetrics *metricdata.ScopeMetrics
	for i := range rm.ScopeMetrics {
		if rm.ScopeMetrics[i].Scope.Name == "otelcol.gpu.collector" {
			scopeMetrics = &rm.ScopeMetrics[i]
			break
		}
	}
	if scopeMetrics == nil {
		t.Fatal("no ScopeMetrics found for otelcol.gpu.collector")
	}

	// Build a set of reported metric names.
	reported := make(map[string]bool)
	for _, m := range scopeMetrics.Metrics {
		reported[m.Name] = true
	}

	wantMetrics := []string{
		"hw.gpu.utilization",
		"hw.gpu.memory.utilization",
		"hw.gpu.memory.limit",
		"hw.gpu.memory.usage",
		"hw.gpu.memory.free",
		"hw.gpu.temperature",
		"hw.gpu.power.draw",
		"hw.gpu.power.limit",
		"hw.gpu.energy.consumed",
		"hw.gpu.clock.graphics",
		"hw.gpu.clock.memory",
		"hw.errors",
	}
	for _, name := range wantMetrics {
		if !reported[name] {
			t.Errorf("expected metric %q to be reported, but it was not", name)
		}
	}
}

func TestNewMetricsCollectorNoDevices(t *testing.T) {
	provider := metric.NewMeterProvider()
	defer provider.Shutdown(t.Context())

	mc, err := NewMetricsCollector(provider, nil, slog.Default())
	if err != nil {
		t.Fatalf("NewMetricsCollector() with no devices error = %v", err)
	}
	mc.Close()
}

func TestMetricsCollectorCloseIdempotent(t *testing.T) {
	provider := metric.NewMeterProvider()
	defer provider.Shutdown(t.Context())

	mc, err := NewMetricsCollector(provider, nil, slog.Default())
	if err != nil {
		t.Fatalf("NewMetricsCollector() error = %v", err)
	}
	// Double-close should not panic.
	mc.Close()
	mc.Close()
}

func TestDeviceAttrs(t *testing.T) {
	info := gpu.DeviceInfo{
		Vendor:     gpu.VendorAMD,
		Index:      2,
		Name:       "Radeon RX 7900 XT",
		UUID:       "GPU-amd-uuid-0001",
		PCIAddress: "0000:03:00.0",
	}
	attrs := deviceAttrs(info)

	lookup := attrs.ToSlice()
	kvMap := make(map[string]string)
	for _, kv := range lookup {
		kvMap[string(kv.Key)] = kv.Value.AsString()
	}

	if kvMap["hw.id"] != info.UUID {
		t.Errorf("hw.id = %q, want %q", kvMap["hw.id"], info.UUID)
	}
	if kvMap["hw.name"] != info.Name {
		t.Errorf("hw.name = %q, want %q", kvMap["hw.name"], info.Name)
	}
	if kvMap["hw.vendor"] != string(info.Vendor) {
		t.Errorf("hw.vendor = %q, want %q", kvMap["hw.vendor"], string(info.Vendor))
	}
}
