package cpupmu

import (
	"log/slog"
	"testing"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
)

func TestResolveEvents(t *testing.T) {
	core, uncore := resolveEvents([]string{"instructions", "cycles", "cache", "branch", "memory_bandwidth"})
	if !uncore {
		t.Fatal("expected wantUncore for memory_bandwidth")
	}
	var hasInstr, hasCycles, hasCache, hasBranch bool
	for _, s := range core {
		switch s.Name {
		case "instructions":
			hasInstr = true
		case "cycles":
			hasCycles = true
		case "cache":
			hasCache = true
		case "branch":
			hasBranch = true
		}
	}
	if !hasInstr || !hasCycles || !hasCache || !hasBranch {
		t.Fatalf("missing events: %+v", core)
	}
	onlyCore, onlyUncore := resolveEvents([]string{"memory_bandwidth", "uncore"})
	if len(onlyCore) != 0 || !onlyUncore {
		t.Fatalf("expected uncore-only request, core=%v uncore=%v", onlyCore, onlyUncore)
	}
}

func TestUnavailablePath(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	fake := &FakeReader{Avail: false}
	cfg := &config.Config{PMUEnabled: true, PMUEvents: []string{"instructions", "cycles"}}
	c, err := NewCollectorWithReader(provider, cfg, fake, slog.Default())
	if err != nil {
		t.Fatalf("NewCollectorWithReader: %v", err)
	}
	defer c.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}

	var avail int64 = -1
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name != "otelcol.cpupmu" {
			continue
		}
		for _, m := range sm.Metrics {
			if m.Name != "openlit.collector.pmu.available" {
				continue
			}
			g, ok := m.Data.(metricdata.Gauge[int64])
			if !ok || len(g.DataPoints) == 0 {
				t.Fatalf("unexpected available data: %#v", m.Data)
			}
			avail = g.DataPoints[0].Value
		}
	}
	if avail != 0 {
		t.Fatalf("available = %d, want 0", avail)
	}
	if fake.ReadCalls != 0 {
		t.Fatalf("unavailable reader should not be Read, got %d calls", fake.ReadCalls)
	}
}

func TestFakeReaderEmitsCounters(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	fake := &FakeReader{
		Avail: true,
		Samples: []Sample{
			{Name: "instructions", Value: 1000},
			{Name: "cycles", Value: 2000},
			{Name: "cache", Value: 50, Attrs: map[string]string{"hw.cpu.cache.level": "l1d", "hw.cpu.cache.op": "miss"}},
			{Name: "branch", Value: 10, Attrs: map[string]string{"hw.cpu.branch.result": "mispredicted"}},
		},
	}
	cfg := &config.Config{PMUEnabled: true}
	c, err := NewCollectorWithReader(provider, cfg, fake, slog.Default())
	if err != nil {
		t.Fatalf("NewCollectorWithReader: %v", err)
	}
	defer c.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}

	got := map[string]int64{}
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name != "otelcol.cpupmu" {
			continue
		}
		for _, m := range sm.Metrics {
			switch data := m.Data.(type) {
			case metricdata.Sum[int64]:
				var sum int64
				for _, dp := range data.DataPoints {
					sum += dp.Value
				}
				got[m.Name] = sum
			case metricdata.Gauge[int64]:
				if len(data.DataPoints) > 0 {
					got[m.Name] = data.DataPoints[0].Value
				}
			}
		}
	}
	if got["hw.cpu.instructions"] != 1000 {
		t.Errorf("instructions = %d", got["hw.cpu.instructions"])
	}
	if got["hw.cpu.cycles"] != 2000 {
		t.Errorf("cycles = %d", got["hw.cpu.cycles"])
	}
	if got["hw.cpu.cache.events"] != 50 {
		t.Errorf("cache = %d", got["hw.cpu.cache.events"])
	}
	if got["hw.cpu.branch.events"] != 10 {
		t.Errorf("branch = %d", got["hw.cpu.branch.events"])
	}
	if got["openlit.collector.pmu.available"] != 1 {
		t.Errorf("available = %d", got["openlit.collector.pmu.available"])
	}
}
