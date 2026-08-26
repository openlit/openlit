package tpu

import (
	"log/slog"
	"testing"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
)

// Golden body adapted from Google Cloud TPU device-plugin Prometheus exposition.
const goldenTPUBody = `# HELP duty_cycle Percent of time when the TPU was actively processing
# TYPE duty_cycle gauge
duty_cycle{accelerator_id="1234567890123456789-4",container="vllm-worker",make="cloud-tpu",model="tpu7x",namespace="test-namespace",pod="test-workload-pod",tpu_topology="2x2x2"} 75
# HELP duty_cycle_node Percent of time when the TPU was actively processing
# TYPE duty_cycle_node gauge
duty_cycle_node{accelerator_id="1234567890123456789-0",make="cloud-tpu",model="tpu7x",tpu_topology="2x2x2"} 0
# HELP memory_total Total memory available on the TPU in bytes
# TYPE memory_total gauge
memory_total{accelerator_id="1234567890123456789-4",container="vllm-worker",make="cloud-tpu",model="tpu7x",namespace="test-namespace",pod="test-workload-pod",tpu_topology="2x2x2"} 2.03465670656e+11
# HELP memory_used Allocated TPU memory in bytes
# TYPE memory_used gauge
memory_used{accelerator_id="1234567890123456789-4",container="vllm-worker",make="cloud-tpu",model="tpu7x",namespace="test-namespace",pod="test-workload-pod",tpu_topology="2x2x2"} 1.76938736128e+11
# HELP memory_bandwidth_utilization_node Memory bandwidth utilization of the TPU device per node
# TYPE memory_bandwidth_utilization_node gauge
memory_bandwidth_utilization_node{accelerator_id="1234567890123456789-0",make="cloud-tpu",model="tpu7x",tpu_topology="2x2x2"} 42.5
# HELP tensorcore_utilization_node Tensorcore percent utilization of the TPU device per node
# TYPE tensorcore_utilization_node gauge
tensorcore_utilization_node{accelerator_id="1234567890123456789-0",make="cloud-tpu",model="tpu7x",tpu_topology="2x2x2"} 10
# HELP go_goroutines Number of goroutines that currently exist.
# TYPE go_goroutines gauge
go_goroutines 34
process_cpu_seconds_total 5699.87
promhttp_metric_handler_requests_total{code="200"} 37730
`

func TestParsePrometheusTextGolden(t *testing.T) {
	samples := ParsePrometheusText(goldenTPUBody)

	find := func(name, accel string) *Sample {
		for i := range samples {
			s := &samples[i]
			if s.Name == name && s.Labels["accelerator_id"] == accel {
				return s
			}
		}
		return nil
	}

	dc := find("duty_cycle", "1234567890123456789-4")
	if dc == nil {
		t.Fatal("missing duty_cycle")
	}
	if dc.Labels["container"] != "vllm-worker" || dc.Value != 75 {
		t.Fatalf("duty_cycle = %+v", dc)
	}

	mem := find("memory_total", "1234567890123456789-4")
	if mem == nil || mem.Value != 2.03465670656e+11 {
		t.Fatalf("memory_total = %+v", mem)
	}

	bw := find("memory_bandwidth_utilization_node", "1234567890123456789-0")
	if bw == nil || bw.Value != 42.5 {
		t.Fatalf("mem bw = %+v", bw)
	}
}

func TestParseDropsNonFinite(t *testing.T) {
	body := "good 1.0\nposinf +Inf\nneginf -Inf\nnotanumber NaN\ngood2 2.0\n"
	samples := ParsePrometheusText(body)
	if len(samples) != 2 {
		t.Fatalf("got %d samples: %+v", len(samples), samples)
	}
}

func TestParseEscapedLabels(t *testing.T) {
	body := `foo{key="line1\nline2",path="a\\b",quote="say \"hi\""} 42` + "\n"
	samples := ParsePrometheusText(body)
	if len(samples) != 1 {
		t.Fatalf("got %d", len(samples))
	}
	if samples[0].Labels["key"] != "line1\nline2" {
		t.Fatalf("key = %q", samples[0].Labels["key"])
	}
	if samples[0].Labels["path"] != `a\b` {
		t.Fatalf("path = %q", samples[0].Labels["path"])
	}
	if samples[0].Labels["quote"] != `say "hi"` {
		t.Fatalf("quote = %q", samples[0].Labels["quote"])
	}
}

func TestAllowlistFiltersRuntime(t *testing.T) {
	samples := ParsePrometheusText(goldenTPUBody)
	allow := []string{"duty_cycle", "tensorcore_utilization", "memory_total", "memory_used", "memory_bandwidth_utilization"}
	filtered := filterAllowlist(samples, allow)
	for _, s := range filtered {
		switch s.Name {
		case "go_goroutines", "process_cpu_seconds_total", "promhttp_metric_handler_requests_total":
			t.Fatalf("allowlist leaked %s", s.Name)
		}
	}
	var hasDuty, hasTC, hasMem, hasBW bool
	for _, s := range filtered {
		switch {
		case stringsHasPrefix(s.Name, "duty_cycle"):
			hasDuty = true
		case stringsHasPrefix(s.Name, "tensorcore_utilization"):
			hasTC = true
		case stringsHasPrefix(s.Name, "memory_total"), stringsHasPrefix(s.Name, "memory_used"):
			hasMem = true
		case stringsHasPrefix(s.Name, "memory_bandwidth_utilization"):
			hasBW = true
		}
	}
	if !hasDuty || !hasTC || !hasMem || !hasBW {
		t.Fatalf("missing families in filtered set (%d samples)", len(filtered))
	}
}

func stringsHasPrefix(s, p string) bool {
	return len(s) >= len(p) && s[:len(p)] == p
}

func TestCollectorObservesGoldenSamples(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	samples := filterAllowlist(ParsePrometheusText(goldenTPUBody), NewScraper("", 1000, nil).allowlist)
	c, err := newCollector(provider, func() ([]Sample, error) {
		return samples, nil
	}, slog.Default())
	if err != nil {
		t.Fatalf("newCollector: %v", err)
	}
	defer c.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}

	got := map[string]float64{}
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name != "otelcol.tpu" {
			continue
		}
		for _, m := range sm.Metrics {
			switch data := m.Data.(type) {
			case metricdata.Gauge[float64]:
				for _, dp := range data.DataPoints {
					if dp.Value > got[m.Name] {
						got[m.Name] = dp.Value
					}
				}
			case metricdata.Sum[int64]:
				for _, dp := range data.DataPoints {
					got[m.Name] = float64(dp.Value)
				}
			}
		}
	}

	if got["hw.tpu.utilization"] != 0.75 {
		t.Errorf("utilization = %v, want 0.75", got["hw.tpu.utilization"])
	}
	if got["hw.tpu.tensorcore.utilization"] != 0.10 {
		t.Errorf("tensorcore = %v, want 0.10", got["hw.tpu.tensorcore.utilization"])
	}
	if got["hw.tpu.memory.bandwidth.utilization"] != 0.425 {
		t.Errorf("mem bw util = %v, want 0.425", got["hw.tpu.memory.bandwidth.utilization"])
	}
	if got["hw.tpu.memory.limit"] != 2.03465670656e+11 {
		t.Errorf("mem limit = %v", got["hw.tpu.memory.limit"])
	}
	if _, ok := got["hw.tpu.memory.utilization"]; !ok {
		t.Error("expected derived memory utilization")
	}
}

func TestScrapeErrorIncrementsCounter(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	c, err := newCollector(provider, func() ([]Sample, error) {
		return nil, errTestScrape
	}, slog.Default())
	if err != nil {
		t.Fatalf("newCollector: %v", err)
	}
	defer c.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}
	var errs int64
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != "openlit.collector.tpu.scrape.errors" {
				continue
			}
			if sum, ok := m.Data.(metricdata.Sum[int64]); ok && len(sum.DataPoints) > 0 {
				errs = sum.DataPoints[0].Value
			}
		}
	}
	if errs != 1 {
		t.Fatalf("scrape errors = %d, want 1", errs)
	}
}

func TestTPUDisabledAfterConsecutiveFails(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	calls := 0
	c, err := newCollector(provider, func() ([]Sample, error) {
		calls++
		return nil, errTestScrape
	}, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()

	for i := 0; i < tpuMaxConsecutiveFails+2; i++ {
		var rm metricdata.ResourceMetrics
		if err := reader.Collect(t.Context(), &rm); err != nil {
			t.Fatal(err)
		}
	}
	if !c.disabled.Load() {
		t.Fatal("expected TPU scrape disabled")
	}
	if calls != tpuMaxConsecutiveFails {
		t.Fatalf("scrape calls = %d, want %d (no calls after disable)", calls, tpuMaxConsecutiveFails)
	}
}

var errTestScrape = errString("scrape failed")

type errString string

func (e errString) Error() string { return string(e) }

func TestNewCollectorFromConfig(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	cfg := &config.Config{
		TPUEnabled:         true,
		TPUEndpoint:        "http://127.0.0.1:9/metrics",
		TPUScrapeTimeoutMS: 100,
	}
	c, err := NewCollector(provider, cfg, slog.Default())
	if err != nil {
		t.Fatalf("NewCollector: %v", err)
	}
	defer c.Close()
}

func TestSampleAttrsNamespacesHWId(t *testing.T) {
	attrs := sampleAttrs(map[string]string{
		"accelerator_id": "abc-4",
		"model":          "tpu7x",
		"make":           "cloud-tpu",
	})
	m := map[string]string{}
	for _, a := range attrs {
		m[string(a.Key)] = a.Value.AsString()
	}
	if m["hw.id"] != "tpu:abc-4" {
		t.Fatalf("hw.id = %q, want tpu:abc-4", m["hw.id"])
	}
	if m["hw.tpu.accelerator_id"] != "abc-4" {
		t.Fatalf("accelerator_id attr = %q", m["hw.tpu.accelerator_id"])
	}
	if m["hw.type"] != "tpu" {
		t.Fatalf("hw.type = %q", m["hw.type"])
	}
}
