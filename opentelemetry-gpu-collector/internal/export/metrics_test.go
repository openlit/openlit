package export

import (
	"log/slog"
	"testing"
	"time"

	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

func (m *mockDevice) Info() gpu.DeviceInfo { return m.info }
func (m *mockDevice) Collect() (*gpu.Snapshot, error) {
	return m.snapshot, m.err
}
func (m *mockDevice) CollectProcesses() ([]gpu.ProcessUsage, error) {
	return m.processes, nil
}
func (m *mockDevice) Close() {}

// mockDevice implements gpu.Device for testing without real hardware.
type mockDevice struct {
	info      gpu.DeviceInfo
	snapshot  *gpu.Snapshot
	processes []gpu.ProcessUsage
	err       error
}

func ptr[T any](v T) *T { return &v }

func testConfig() *config.Config {
	return config.Load()
}

func collectScopeMetrics(t *testing.T, reader *metric.ManualReader) *metricdata.ScopeMetrics {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("reader.Collect() error = %v", err)
	}
	for i := range rm.ScopeMetrics {
		if rm.ScopeMetrics[i].Scope.Name == "otelcol.gpu.collector" {
			return &rm.ScopeMetrics[i]
		}
	}
	t.Fatal("no ScopeMetrics found for otelcol.gpu.collector")
	return nil
}

func reportedNames(sm *metricdata.ScopeMetrics) map[string]bool {
	reported := make(map[string]bool)
	for _, m := range sm.Metrics {
		reported[m.Name] = true
	}
	return reported
}

func TestNewMetricsCollectorRegisters(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	dev := &mockDevice{
		info: gpu.DeviceInfo{
			Vendor:        gpu.VendorNVIDIA,
			Index:         0,
			Name:          "Test GPU",
			UUID:          "GPU-test-uuid-0000",
			PCIAddress:    "0000:01:00.0",
			DriverVersion: "550.54.15",
		},
		snapshot: &gpu.Snapshot{
			Utilization:        ptr(80.0),
			EncoderUtilization: ptr(10.0),
			DecoderUtilization: ptr(5.0),
			MemoryUtilization:  ptr(60.0),
			TemperatureGPU:     ptr(70.0),
			TemperatureMemory:  ptr(65.0),
			FanSpeedRPM:        ptr(2400.0),
			FanSpeedRatio:      ptr(0.48),
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
			PCIeRxBytesPerSec:  ptr(1.5e9),
			PCIeTxBytesPerSec:  ptr(0.8e9),
			Throttled:          ptr(0.0),
			SerialNumber:       "SN-TEST-001",
			FirmwareVersion:    "fw-1.2.3",
		},
	}

	logger := slog.Default()
	mc, err := NewMetricsCollector(provider, []gpu.Device{dev}, logger, testConfig())
	if err != nil {
		t.Fatalf("NewMetricsCollector() error = %v", err)
	}
	defer mc.Close()

	scopeMetrics := collectScopeMetrics(t, reader)
	reported := reportedNames(scopeMetrics)

	wantSpec := []string{
		"hw.gpu.utilization",
		"hw.gpu.memory.utilization",
		"hw.gpu.memory.controller.utilization",
		"hw.gpu.memory.limit",
		"hw.gpu.memory.usage",
		"hw.gpu.memory.free",
		"hw.power",
		"hw.energy",
		"hw.temperature",
		"hw.fan.speed",
		"hw.fan.speed_ratio",
		"hw.power.limit",
		"hw.gpu.speed",
		"hw.gpu.io",
		"hw.status",
		"hw.errors",
		"hw.gpu.allocated",
		"hw.gpu.idle",
	}
	for _, name := range wantSpec {
		if !reported[name] {
			t.Errorf("expected spec metric %q to be reported, but it was not", name)
		}
	}

	for _, name := range []string{
		"hw.gpu.temperature",
		"hw.gpu.fan_speed",
		"hw.gpu.power.draw",
		"hw.gpu.power.limit",
		"hw.gpu.energy.consumed",
		"hw.gpu.clock.graphics",
		"hw.gpu.clock.memory",
		"hw.gpu.up",
		"hw.gpu.pcie.throughput",
		"hw.gpu.throttled",
	} {
		if reported[name] {
			t.Errorf("legacy metric %q must not be emitted", name)
		}
	}
}

func TestNewMetricsCollectorSpecOnly(t *testing.T) {
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
			Utilization:      ptr(50.0),
			TemperatureGPU:   ptr(60.0),
			PowerDrawWatts:   ptr(100.0),
			PowerLimitWatts:  ptr(200.0),
			EnergyJoules:     ptr(1000.0),
			ClockGraphicsMHz: ptr(1500.0),
			ClockMemoryMHz:   ptr(8000.0),
		},
	}

	mc, err := NewMetricsCollector(provider, []gpu.Device{dev}, slog.Default(), testConfig())
	if err != nil {
		t.Fatalf("NewMetricsCollector() error = %v", err)
	}
	defer mc.Close()

	reported := reportedNames(collectScopeMetrics(t, reader))

	for _, name := range []string{"hw.power", "hw.energy", "hw.temperature", "hw.status", "hw.gpu.speed", "hw.power.limit"} {
		if !reported[name] {
			t.Errorf("expected spec metric %q", name)
		}
	}
	for _, name := range []string{
		"hw.gpu.power.draw", "hw.gpu.temperature", "hw.gpu.up",
		"hw.gpu.clock.graphics", "hw.gpu.energy.consumed",
	} {
		if reported[name] {
			t.Errorf("legacy metric %q must not be emitted", name)
		}
	}
}

func TestProcessGPUMetrics(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	mem := int64(1024 * 1024)
	util := 0.42
	dev := &mockDevice{
		info: gpu.DeviceInfo{
			Vendor:     gpu.VendorNVIDIA,
			Index:      0,
			Name:       "Test GPU",
			UUID:       "GPU-test-uuid-0000",
			PCIAddress: "0000:01:00.0",
		},
		snapshot: &gpu.Snapshot{
			Utilization:      ptr(10.0),
			MemoryTotalBytes: ptr(int64(4 * 1024 * 1024)),
		},
		processes: []gpu.ProcessUsage{{
			PID:            4242,
			ExecutableName: "python",
			MemoryBytes:    &mem,
			Utilization:    &util,
		}},
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

	foundMem, foundUtil, foundMemUtil := false, false, false
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name != "otelcol.gpu.collector" {
			continue
		}
		for _, m := range sm.Metrics {
			switch m.Name {
			case "process.gpu.memory.usage":
				foundMem = true
			case "process.gpu.utilization":
				foundUtil = true
			case "process.gpu.memory.utilization":
				foundMemUtil = true
				gauge := m.Data.(metricdata.Gauge[float64])
				if len(gauge.DataPoints) != 1 || gauge.DataPoints[0].Value != 0.25 {
					t.Fatalf("memory.utilization = %#v, want 0.25", gauge.DataPoints)
				}
			}
		}
	}
	if !foundMem || !foundUtil || !foundMemUtil {
		t.Fatalf("process metrics missing: mem=%v util=%v memUtil=%v", foundMem, foundUtil, foundMemUtil)
	}
}

func TestNewMetricsCollectorNoDevices(t *testing.T) {
	provider := metric.NewMeterProvider()
	defer provider.Shutdown(t.Context())

	mc, err := NewMetricsCollector(provider, nil, slog.Default(), testConfig())
	if err != nil {
		t.Fatalf("NewMetricsCollector() with no devices error = %v", err)
	}
	mc.Close()
}

func TestMetricsCollectorCloseIdempotent(t *testing.T) {
	provider := metric.NewMeterProvider()
	defer provider.Shutdown(t.Context())

	mc, err := NewMetricsCollector(provider, nil, slog.Default(), testConfig())
	if err != nil {
		t.Fatalf("NewMetricsCollector() error = %v", err)
	}
	// Double-close should not panic.
	mc.Close()
	mc.Close()
}

func TestDeviceAttrs(t *testing.T) {
	info := gpu.DeviceInfo{
		Vendor:        gpu.VendorAMD,
		Index:         2,
		Name:          "Radeon RX 7900 XT",
		UUID:          "GPU-amd-uuid-0001",
		PCIAddress:    "0000:03:00.0",
		DriverVersion: "6.1.5",
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
	if kvMap["hw.model"] != info.Name {
		t.Errorf("hw.model = %q, want %q", kvMap["hw.model"], info.Name)
	}
	if kvMap["hw.vendor"] != string(info.Vendor) {
		t.Errorf("hw.vendor = %q, want %q", kvMap["hw.vendor"], string(info.Vendor))
	}
	if kvMap["hw.type"] != "gpu" {
		t.Errorf("hw.type = %q, want %q", kvMap["hw.type"], "gpu")
	}
	if kvMap["gpu.measurement.source"] != "amdsmi" {
		t.Errorf("gpu.measurement.source = %q, want amdsmi", kvMap["gpu.measurement.source"])
	}
	if kvMap["hw.driver_version"] != info.DriverVersion {
		t.Errorf("hw.driver_version = %q, want %q", kvMap["hw.driver_version"], info.DriverVersion)
	}
}

func TestDeviceAttrsMIG(t *testing.T) {
	info := gpu.DeviceInfo{
		Vendor:     gpu.VendorNVIDIA,
		Index:      0,
		Name:       "MIG GPU",
		UUID:       "MIG-uuid",
		PCIAddress: "0000:01:00.0",
		IsMIG:      true,
		ParentUUID: "GPU-parent-uuid",
	}
	attrs := deviceAttrs(info)
	kvMap := make(map[string]string)
	for _, kv := range attrs.ToSlice() {
		kvMap[string(kv.Key)] = kv.Value.AsString()
	}
	if kvMap["hw.parent"] != info.ParentUUID {
		t.Errorf("hw.parent = %q, want %q", kvMap["hw.parent"], info.ParentUUID)
	}
}

func TestEnrichSnapshotAttrs(t *testing.T) {
	base := deviceAttrs(gpu.DeviceInfo{UUID: "u", Name: "n", Vendor: gpu.VendorNVIDIA})
	enriched := enrichSnapshotAttrs(base, &gpu.Snapshot{
		SerialNumber:    "SN1",
		FirmwareVersion: "FW1",
	})
	kvMap := make(map[string]string)
	for _, kv := range enriched.ToSlice() {
		kvMap[string(kv.Key)] = kv.Value.AsString()
	}
	if kvMap["hw.serial_number"] != "SN1" {
		t.Errorf("hw.serial_number = %q", kvMap["hw.serial_number"])
	}
	if kvMap["hw.firmware_version"] != "FW1" {
		t.Errorf("hw.firmware_version = %q", kvMap["hw.firmware_version"])
	}
}

func TestPCIeRateIntegration(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	cfg := testConfig()
	cfg.CollectionInterval = time.Second

	dev := &mockDevice{
		info: gpu.DeviceInfo{
			Vendor:     gpu.VendorNVIDIA,
			Index:      0,
			Name:       "Test GPU",
			UUID:       "GPU-pcie-test",
			PCIAddress: "0000:01:00.0",
		},
		snapshot: &gpu.Snapshot{
			PCIeRxBytesPerSec: ptr(1000.0),
			PCIeTxBytesPerSec: ptr(500.0),
		},
	}

	mc, err := NewMetricsCollector(provider, []gpu.Device{dev}, slog.Default(), cfg)
	if err != nil {
		t.Fatalf("NewMetricsCollector: %v", err)
	}
	defer mc.Close()

	reported := reportedNames(collectScopeMetrics(t, reader))
	if !reported["hw.gpu.io"] {
		t.Fatal("expected hw.gpu.io from rate integration")
	}
}
