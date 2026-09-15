package main

import (
	"strings"
	"testing"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
)

func TestFeatureReportUnavailableOnly(t *testing.T) {
	var r featureReport
	r.unavailableFeature(nil, config.FeatureDCGM, "no libdcgm")
	r.unavailableFeature(nil, config.FeatureEBPF, "no CAP_BPF")
	if err := r.err(); err != nil {
		t.Fatalf("unavailable-only should not be fatal: %v", err)
	}
	if len(r.unavailable) != 2 {
		t.Fatalf("unavailable count = %d, want 2", len(r.unavailable))
	}
}

func TestFeatureReportFaultIsFatal(t *testing.T) {
	var r featureReport
	r.fault(nil, config.FeatureHostMetrics, "creating system.cpu.utilization: boom")
	err := r.err()
	if err == nil {
		t.Fatal("expected fatal fault")
	}
	if !strings.Contains(err.Error(), config.FeatureHostMetrics) {
		t.Fatalf("error should name feature: %v", err)
	}
}

func TestFeatureReportMixedNamesOnlyFaults(t *testing.T) {
	var r featureReport
	r.unavailableFeature(nil, config.FeatureRDC, "no librdc")
	r.fault(nil, config.FeatureVendorMetrics, "creating hw.gpu.utilization: boom")
	r.unavailableFeature(nil, config.FeatureIntelPT, "no perf")
	err := r.err()
	if err == nil {
		t.Fatal("expected fatal from fault")
	}
	if !strings.Contains(err.Error(), config.FeatureVendorMetrics) {
		t.Fatalf("error should include fault: %v", err)
	}
	if strings.Contains(err.Error(), config.FeatureRDC) || strings.Contains(err.Error(), config.FeatureIntelPT) {
		t.Fatalf("error should not include unavailable features: %v", err)
	}
	names := failureNames(r.faults)
	if len(names) != 1 || names[0] != config.FeatureVendorMetrics {
		t.Fatalf("fault names = %v", names)
	}
}
