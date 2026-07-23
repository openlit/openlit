package hostmetrics

import (
	"flag"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
)

var snapshotConfig = flag.Bool("snapshot.config", false,
	"TestSystemCollectorSnapshot: build the collector from config.Load() (honoring env vars such as OTEL_GPU_FS_TYPES_EXCLUDE) instead of unfiltered")

// TestSystemCollectorSnapshot logs a single snapshot of every metric the
// system collector reports on this host, one line per datapoint. Run with
// -v to see the output:
//
//	go test ./internal/hostmetrics/ -run TestSystemCollectorSnapshot -v
//
// By default the collector is unfiltered (ground truth of what the host
// exposes). Pass -snapshot.config after -args to build it from the
// environment the way cmd/collector does, filesystem filter included:
//
//	OTEL_GPU_FS_TYPES_EXCLUDE=apfs go test ./internal/hostmetrics/ -run TestSystemCollectorSnapshot -v -args -snapshot.config
func TestSystemCollectorSnapshot(t *testing.T) {
	var fsTypesExclude []string
	if *snapshotConfig {
		fsTypesExclude = config.Load().FSTypesExclude
		t.Logf("config loaded: filesystem exclude list %v", fsTypesExclude)
	}

	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	defer provider.Shutdown(t.Context())

	sc, err := NewSystemCollector(provider, slog.Default(), fsTypesExclude)
	if err != nil {
		t.Fatalf("NewSystemCollector() error = %v", err)
	}
	defer sc.Close()

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(t.Context(), &rm); err != nil {
		t.Fatalf("reader.Collect() error = %v", err)
	}

	attrString := func(set attribute.Set) string {
		items := make([]string, 0, set.Len())
		for iter := set.Iter(); iter.Next(); {
			kv := iter.Attribute()
			items = append(items, fmt.Sprintf("%s=%s", kv.Key, kv.Value.Emit()))
		}
		return strings.Join(items, " ")
	}

	for _, sm := range rm.ScopeMetrics {
		t.Logf("scope %s@%s", sm.Scope.Name, sm.Scope.Version)
		for _, m := range sm.Metrics {
			t.Logf("  %s (%s): %s", m.Name, m.Unit, m.Description)
			switch data := m.Data.(type) {
			case metricdata.Sum[int64]:
				for _, dp := range data.DataPoints {
					t.Logf("    {%s} %d", attrString(dp.Attributes), dp.Value)
				}
			case metricdata.Sum[float64]:
				for _, dp := range data.DataPoints {
					t.Logf("    {%s} %g", attrString(dp.Attributes), dp.Value)
				}
			case metricdata.Gauge[int64]:
				for _, dp := range data.DataPoints {
					t.Logf("    {%s} %d", attrString(dp.Attributes), dp.Value)
				}
			case metricdata.Gauge[float64]:
				for _, dp := range data.DataPoints {
					t.Logf("    {%s} %g", attrString(dp.Attributes), dp.Value)
				}
			default:
				t.Logf("    (unhandled data type %T)", m.Data)
			}
		}
	}
}
