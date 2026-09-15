package kineto

import (
	"testing"
)

func TestConfigTextDuration(t *testing.T) {
	r := Request{
		LogFile:     "/tmp/test_trace.json",
		Mode:        TriggerDuration,
		StartTimeMS: 1000,
		DurationMS:  42,
		Options: Options{
			RecordShapes: true,
			WithStacks:   true,
			WithFlops:    false,
			WithModules:  true,
		},
	}
	want := `ACTIVITIES_LOG_FILE=/tmp/test_trace.json
PROFILE_START_TIME=1000
ACTIVITIES_DURATION_MSECS=42
PROFILE_REPORT_INPUT_SHAPES=true
PROFILE_WITH_STACK=true
PROFILE_WITH_FLOPS=false
PROFILE_WITH_MODULES=true`
	if got := r.ConfigText(); got != want {
		t.Fatalf("ConfigText mismatch\ngot:\n%s\nwant:\n%s", got, want)
	}
}

func TestConfigTextDurationMemory(t *testing.T) {
	r := Request{
		LogFile:     "/tmp/test_trace.json",
		Mode:        TriggerDuration,
		StartTimeMS: 1000,
		DurationMS:  42,
		Options: Options{
			RecordShapes:  true,
			ProfileMemory: true,
			WithStacks:    true,
			WithFlops:     false,
			WithModules:   true,
		},
	}
	want := `ACTIVITIES_LOG_FILE=/tmp/test_trace.json
PROFILE_START_TIME=1000
ACTIVITIES_DURATION_MSECS=42
PROFILE_REPORT_INPUT_SHAPES=true
PROFILE_PROFILE_MEMORY=true
PROFILE_MEMORY=true
PROFILE_MEMORY_DURATION_MSECS=42
PROFILE_WITH_STACK=true
PROFILE_WITH_FLOPS=false
PROFILE_WITH_MODULES=true`
	if got := r.ConfigText(); got != want {
		t.Fatalf("ConfigText memory mismatch\ngot:\n%s\nwant:\n%s", got, want)
	}
}

func TestConfigTextIteration(t *testing.T) {
	r := Request{
		LogFile:          "/tmp/test_trace.json",
		Mode:             TriggerIteration,
		Iterations:       42,
		IterationRoundup: 1000,
		Options: Options{
			RecordShapes: true,
			WithStacks:   true,
			WithFlops:    false,
			WithModules:  true,
		},
	}
	want := `ACTIVITIES_LOG_FILE=/tmp/test_trace.json
PROFILE_START_ITERATION=0
PROFILE_START_ITERATION_ROUNDUP=1000
ACTIVITIES_ITERATIONS=42
PROFILE_REPORT_INPUT_SHAPES=true
PROFILE_WITH_STACK=true
PROFILE_WITH_FLOPS=false
PROFILE_WITH_MODULES=true`
	if got := r.ConfigText(); got != want {
		t.Fatalf("ConfigText iteration mismatch\ngot:\n%s\nwant:\n%s", got, want)
	}
}

func TestConfigTextMemoryIterationPanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic for ProfileMemory with TriggerIteration")
		}
	}()
	r := Request{
		LogFile:    "/tmp/x.json",
		Mode:       TriggerIteration,
		Iterations: 5,
		Options:    Options{ProfileMemory: true},
	}
	_ = r.ConfigText()
}

func TestTracePathForPID(t *testing.T) {
	if got := TracePathForPID("/tmp/libkineto_trace.json", 151419); got != "/tmp/libkineto_trace_151419.json" {
		t.Fatalf("got %q", got)
	}
}
