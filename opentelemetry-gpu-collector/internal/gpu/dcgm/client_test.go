package dcgm

import (
	"testing"
	"time"
)

func TestUnavailableClient(t *testing.T) {
	c := UnavailableClient{}
	if c.Available() {
		t.Fatal("UnavailableClient.Available() = true")
	}
	samples, err := c.Sample()
	if err != nil || samples != nil {
		t.Fatalf("Sample() = %v, %v", samples, err)
	}
	if err := c.PauseProfiling(time.Second); err != nil {
		t.Fatalf("PauseProfiling: %v", err)
	}
	if err := c.ResumeProfiling(); err != nil {
		t.Fatalf("ResumeProfiling: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

func TestParseFieldsCSV(t *testing.T) {
	got := ParseFieldsCSV("50, 100,1001, bad, 1002,1001")
	want := []uint16{50, 100, 1001, 1002}
	if len(got) != len(want) {
		t.Fatalf("len=%d want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("got[%d]=%d want %d", i, got[i], want[i])
		}
	}
	if ParseFieldsCSV("") != nil {
		t.Fatal("empty should be nil")
	}
}

func TestFieldIDToMetricNVIDIA(t *testing.T) {
	// NVIDIA DCGM: 155=power, 203=gpu util, 204=mem copy util — never treat 155 as util.
	if FieldPowerUsage != 155 {
		t.Fatalf("FieldPowerUsage=%d want 155", FieldPowerUsage)
	}
	if FieldGPUUtil != 203 {
		t.Fatalf("FieldGPUUtil=%d want 203", FieldGPUUtil)
	}
	if FieldIDToMetric[155] != MetricPowerWatts {
		t.Fatalf("155 maps to %q want %q", FieldIDToMetric[155], MetricPowerWatts)
	}
	if FieldIDToMetric[203] != MetricGPUUtilPct {
		t.Fatalf("203 maps to %q want %q", FieldIDToMetric[203], MetricGPUUtilPct)
	}
	if FieldIDToMetric[204] != MetricMemCopyUtil {
		t.Fatalf("204 maps to %q want %q", FieldIDToMetric[204], MetricMemCopyUtil)
	}
}

func TestEnsureIdentityFields(t *testing.T) {
	got := EnsureIdentityFields([]uint16{50, 100})
	found := false
	for _, f := range got {
		if f == FieldUUID {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected UUID field 54, got %v", got)
	}
	got2 := EnsureIdentityFields([]uint16{54, 100})
	if len(got2) != 2 {
		t.Fatalf("should not duplicate UUID: %v", got2)
	}
}

func TestSplitProfFields(t *testing.T) {
	reg, prof := SplitProfFields([]uint16{50, 100, 1001, 1005})
	if len(reg) != 2 || len(prof) != 2 {
		t.Fatalf("reg=%v prof=%v", reg, prof)
	}
}

func TestPauseControllerAutoResume(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	p := newPauseController()
	p.setNow(func() time.Time { return now })

	if p.Paused() {
		t.Fatal("should not be paused initially")
	}
	p.Pause(2 * time.Second)
	if !p.Paused() {
		t.Fatal("should be paused")
	}
	now = now.Add(1 * time.Second)
	if !p.Paused() {
		t.Fatal("should still be paused after 1s")
	}
	now = now.Add(2 * time.Second)
	if p.Paused() {
		t.Fatal("should auto-resume after deadline")
	}
	if p.Paused() {
		t.Fatal("should stay resumed")
	}
}

func TestFakeClientPauseSkipsProf(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	f := NewFakeClient(Sample{
		DeviceID: "GPU-1",
		GPUID:    0,
		Values: map[string]float64{
			MetricSMUtil:     0.5,
			MetricSMClockMHz: 1800,
		},
	})
	f.SetClock(func() time.Time { return now })

	if err := f.PauseProfiling(5 * time.Second); err != nil {
		t.Fatal(err)
	}
	samples, err := f.Sample()
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 1 {
		t.Fatalf("len=%d", len(samples))
	}
	if _, ok := samples[0].Values[MetricSMUtil]; ok {
		t.Fatal("prof metric should be skipped while paused")
	}
	if samples[0].Values[MetricSMClockMHz] != 1800 {
		t.Fatalf("clock should remain: %v", samples[0].Values)
	}

	now = now.Add(6 * time.Second)
	samples, err = f.Sample()
	if err != nil {
		t.Fatal(err)
	}
	if samples[0].Values[MetricSMUtil] != 0.5 {
		t.Fatalf("prof metric should return after auto-resume: %v", samples[0].Values)
	}
}

func TestNewClientMissingLib(t *testing.T) {
	c, err := NewClient("/nonexistent/libdcgm.so", "", "100,1001", time.Second, nil)
	if err != nil {
		t.Fatalf("NewClient should soft-fail, got err=%v", err)
	}
	if c.Available() {
		t.Fatal("expected unavailable")
	}
}
