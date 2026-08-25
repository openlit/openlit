package hostmetrics

import (
	"log/slog"
	"slices"
	"testing"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
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
		"system.cpu.time",
		"system.cpu.logical.count",
		"system.cpu.physical.count",
		"system.uptime",
		"system.memory.usage",
		"system.memory.utilization",
		"system.paging.usage",
		"system.paging.utilization",
		"system.disk.io",
		"system.disk.operations",
		"system.filesystem.usage",
		"system.filesystem.utilization",
		"system.network.io",
		"system.network.errors",
		"system.network.packet.count",
		"system.network.packet.dropped",
		"system.process.count",
	}
	for _, name := range wantMetrics {
		if !reported[name] {
			t.Errorf("expected metric %q to be reported", name)
		}
	}
}

func TestSystemCollectorFSTypeExclude(t *testing.T) {
	reportedFSTypes := func(rm *metricdata.ResourceMetrics) []string {
		seen := map[string]bool{}
		for _, sm := range rm.ScopeMetrics {
			for _, m := range sm.Metrics {
				switch m.Name {
				case "system.filesystem.usage", "system.filesystem.utilization":
				default:
					continue
				}
				var attrSets []attribute.Set
				switch data := m.Data.(type) {
				case metricdata.Sum[int64]:
					for _, dp := range data.DataPoints {
						attrSets = append(attrSets, dp.Attributes)
					}
				case metricdata.Gauge[float64]:
					for _, dp := range data.DataPoints {
						attrSets = append(attrSets, dp.Attributes)
					}
				}
				for _, attrs := range attrSets {
					if v, ok := attrs.Value(attribute.Key("system.filesystem.type")); ok {
						seen[v.AsString()] = true
					}
				}
			}
		}
		types := make([]string, 0, len(seen))
		for fsType := range seen {
			types = append(types, fsType)
		}
		return types
	}

	collect := func(t *testing.T, exclude []string) []string {
		t.Helper()
		reader := metric.NewManualReader()
		provider := metric.NewMeterProvider(metric.WithReader(reader))
		defer provider.Shutdown(t.Context())

		sc, err := NewSystemCollector(provider, slog.Default(), &config.Config{FSTypesExclude: exclude})
		if err != nil {
			t.Fatalf("NewSystemCollector() error = %v", err)
		}
		defer sc.Close()

		var rm metricdata.ResourceMetrics
		if err := reader.Collect(t.Context(), &rm); err != nil {
			t.Fatalf("reader.Collect() error = %v", err)
		}
		return reportedFSTypes(&rm)
	}

	all := collect(t, nil)
	if len(all) == 0 {
		t.Skip("host reports no system.filesystem.* metrics")
	}
	slices.Sort(all)

	if got := collect(t, all); len(got) != 0 {
		t.Errorf("expected no filesystem types with all types excluded, got %v", got)
	}

	got := collect(t, []string{"no-such-fs"})
	slices.Sort(got)
	if !slices.Equal(got, all) {
		t.Errorf("reported types changed by irrelevant exclusion: got %v, want %v", got, all)
	}
}

func TestSystemCollectorNetInterfaceFilter(t *testing.T) {
	collectIfaces := func(t *testing.T, cfg *config.Config) []string {
		t.Helper()
		reader := metric.NewManualReader()
		provider := metric.NewMeterProvider(metric.WithReader(reader))
		defer provider.Shutdown(t.Context())

		sc, err := NewSystemCollector(provider, slog.Default(), cfg)
		if err != nil {
			t.Fatalf("NewSystemCollector() error = %v", err)
		}
		defer sc.Close()

		var rm metricdata.ResourceMetrics
		if err := reader.Collect(t.Context(), &rm); err != nil {
			t.Fatalf("reader.Collect() error = %v", err)
		}

		seen := map[string]bool{}
		for _, sm := range rm.ScopeMetrics {
			for _, m := range sm.Metrics {
				if m.Name != "system.network.io" {
					continue
				}
				data, ok := m.Data.(metricdata.Sum[int64])
				if !ok {
					continue
				}
				for _, dp := range data.DataPoints {
					if v, ok := dp.Attributes.Value(attribute.Key("network.interface.name")); ok {
						seen[v.AsString()] = true
					}
				}
			}
		}
		out := make([]string, 0, len(seen))
		for n := range seen {
			out = append(out, n)
		}
		slices.Sort(out)
		return out
	}

	all := collectIfaces(t, &config.Config{})
	if len(all) == 0 {
		t.Skip("host reports no network interfaces")
	}

	excluded := collectIfaces(t, &config.Config{NetInterfaceExclude: all})
	if len(excluded) != 0 {
		t.Errorf("expected no interfaces when all excluded, got %v", excluded)
	}

	allow := collectIfaces(t, &config.Config{NetInterfaces: []string{all[0]}})
	if !slices.Equal(allow, []string{all[0]}) {
		t.Errorf("allow list = %v, want [%s]", allow, all[0])
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
