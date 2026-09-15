package rdc

import "testing"

func TestUnavailableClient(t *testing.T) {
	c := UnavailableClient{}
	if c.Available() {
		t.Fatal("UnavailableClient.Available() = true")
	}
	samples, err := c.Sample()
	if err != nil || samples != nil {
		t.Fatalf("Sample() = %v, %v", samples, err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

func TestNewClientMissingLib(t *testing.T) {
	c, err := NewClient("/nonexistent/librdc.so", nil)
	if err != nil {
		t.Fatalf("NewClient should soft-fail, got err=%v", err)
	}
	if c.Available() {
		t.Fatal("expected unavailable")
	}
}

func TestMapFieldValue(t *testing.T) {
	vals := map[string]float64{}
	MapFieldValue(vals, FieldOccupancyPercent, 45.0)
	if vals[MetricOccupancy] != 0.45 {
		t.Fatalf("occupancy = %v, want 0.45", vals[MetricOccupancy])
	}
	MapFieldValue(vals, FieldEvalFLOPS16Percent, 0.21)
	if vals[MetricPipeFP16] != 0.21 {
		t.Fatalf("fp16 = %v", vals[MetricPipeFP16])
	}
	MapFieldValue(vals, FieldEvalFLOPS32Percent, 0.10)
	MapFieldValue(vals, FieldEvalFLOPS64Percent, 0.01)
	MapFieldValue(vals, FieldSIMDUtilization, 80.0)
	if vals[MetricSIMDUtil] != 0.80 {
		t.Fatalf("simd = %v, want 0.80", vals[MetricSIMDUtil])
	}
	MapFieldValue(vals, 99999, 1.0) // unknown field ignored
	if len(vals) != 5 {
		t.Fatalf("len=%d want 5: %v", len(vals), vals)
	}
}

func TestRDCFieldIDsMatchHeader(t *testing.T) {
	if FieldOccupancyPercent != 800 || FieldEvalFLOPS16Percent != 815 || FieldSIMDUtilization != 853 {
		t.Fatalf("unexpected field IDs: occ=%d fp16=%d simd=%d",
			FieldOccupancyPercent, FieldEvalFLOPS16Percent, FieldSIMDUtilization)
	}
}

func TestFakeClientSample(t *testing.T) {
	f := NewFakeClient(Sample{
		DeviceID:  "GPU-rdc-0",
		GPUID:     0,
		ParentID:  "GPU-parent",
		Partition: "xcd0",
		Values: map[string]float64{
			MetricOccupancy: 0.33,
			MetricPipeFP16:  0.2,
			MetricSIMDUtil:  0.7,
		},
	})
	samples, err := f.Sample()
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 1 {
		t.Fatalf("len=%d", len(samples))
	}
	if samples[0].ParentID != "GPU-parent" || samples[0].Partition != "xcd0" {
		t.Fatalf("partition attrs: %+v", samples[0])
	}
	if samples[0].Values[MetricOccupancy] != 0.33 {
		t.Fatalf("values: %v", samples[0].Values)
	}
	_ = f.Close()
	if f.Available() {
		t.Fatal("expected unavailable after Close")
	}
}
