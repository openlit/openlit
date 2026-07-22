package hostmetrics

import (
	"log/slog"
	"testing"

	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestNewSystemCollectorInitializes(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	sc, err := NewSystemCollector(provider, slog.Default(), nil)
	if err != nil {
		t.Fatalf("NewSystemCollector() error = %v", err)
	}
	defer sc.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("reader.Collect() error = %v", err)
	}

	var found bool
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name == "otelcol.system" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected ScopeMetrics for otelcol.system")
	}
}

func TestSystemCollectorInstrumentNames(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	sc, err := NewSystemCollector(provider, slog.Default(), nil)
	if err != nil {
		t.Fatalf("NewSystemCollector() error = %v", err)
	}
	defer sc.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("reader.Collect() error = %v", err)
	}

	reported := make(map[string]bool)
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name == "otelcol.system" {
			for _, m := range sm.Metrics {
				reported[m.Name] = true
			}
		}
	}

	wantMetrics := []string{
		"system.cpu.utilization",
		"system.cpu.logical.count",
		"system.memory.usage",
		"system.memory.utilization",
		"system.disk.io",
		"system.disk.operations",
		"system.filesystem.usage",
		"system.filesystem.utilization",
		"system.network.io",
		"system.network.errors",
	}
	for _, name := range wantMetrics {
		if !reported[name] {
			t.Errorf("expected metric %q to be reported", name)
		}
	}
}

func TestSystemCollectorFSTypeFilter(t *testing.T) {
	fsMetrics := func(rm *metricdata.ResourceMetrics) (n int) {
		for _, sm := range rm.ScopeMetrics {
			for _, m := range sm.Metrics {
				switch m.Name {
				case "system.filesystem.usage", "system.filesystem.utilization":
					n++
				}
			}
		}
		return n
	}

	// An allowlist matching no real filesystem type must suppress all
	// system.filesystem.* metrics.
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	sc, err := NewSystemCollector(provider, slog.Default(), []string{"no-such-fs"})
	if err != nil {
		t.Fatalf("NewSystemCollector() error = %v", err)
	}
	defer sc.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("reader.Collect() error = %v", err)
	}
	if n := fsMetrics(&rm); n != 0 {
		t.Errorf("expected no system.filesystem.* metrics with non-matching allowlist, got %d", n)
	}

	// A "*" entry disables filtering entirely.
	readerAll := metric.NewManualReader()
	providerAll := metric.NewMeterProvider(metric.WithReader(readerAll))
	defer providerAll.Shutdown(t.Context())

	scAll, err := NewSystemCollector(providerAll, slog.Default(), []string{"*"})
	if err != nil {
		t.Fatalf("NewSystemCollector() error = %v", err)
	}
	defer scAll.Close()
	if scAll.fsTypes != nil {
		t.Error(`expected fsTypes to be nil (no filtering) for allowlist ["*"]`)
	}
}

func TestSystemCollectorCloseIdempotent(t *testing.T) {
	provider := metric.NewMeterProvider()
	defer provider.Shutdown(t.Context())

	sc, err := NewSystemCollector(provider, slog.Default(), nil)
	if err != nil {
		t.Fatalf("NewSystemCollector() error = %v", err)
	}
	sc.Close()
	sc.Close() // should not panic
}

func TestNewProcessCollectorInitializes(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	pc, err := NewProcessCollector(provider, slog.Default())
	if err != nil {
		t.Fatalf("NewProcessCollector() error = %v", err)
	}
	defer pc.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("reader.Collect() error = %v", err)
	}

	var found bool
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name == "otelcol.process" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected ScopeMetrics for otelcol.process")
	}
}

func TestProcessCollectorInstrumentNames(t *testing.T) {
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	pc, err := NewProcessCollector(provider, slog.Default())
	if err != nil {
		t.Fatalf("NewProcessCollector() error = %v", err)
	}
	defer pc.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("reader.Collect() error = %v", err)
	}

	reported := make(map[string]bool)
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name == "otelcol.process" {
			for _, m := range sm.Metrics {
				reported[m.Name] = true
			}
		}
	}

	wantMetrics := []string{
		"process.cpu.time",
		"process.cpu.utilization",
		"process.memory.usage",
		"process.memory.virtual",
		"process.thread.count",
		"process.runtime.go.goroutines",
		"process.runtime.go.mem.heap_alloc",
	}
	for _, name := range wantMetrics {
		if !reported[name] {
			t.Errorf("expected metric %q to be reported", name)
		}
	}
}

func TestProcessCollectorCloseIdempotent(t *testing.T) {
	provider := metric.NewMeterProvider()
	defer provider.Shutdown(t.Context())

	pc, err := NewProcessCollector(provider, slog.Default())
	if err != nil {
		t.Fatalf("NewProcessCollector() error = %v", err)
	}
	pc.Close()
	pc.Close() // should not panic
}
