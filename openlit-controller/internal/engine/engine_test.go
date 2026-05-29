package engine

import (
	"testing"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
	"go.uber.org/zap"
)

func newTestEngine() *Engine {
	logger, _ := zap.NewDevelopment()
	eng := New(logger, "/nonexistent/obi", "http://localhost:4318", "/proc", "test", "", config.DeployLinux)
	return eng
}

func TestServiceCountInitiallyZero(t *testing.T) {
	eng := newTestEngine()
	discovered, instrumented := eng.ServiceCount()
	if discovered != 0 || instrumented != 0 {
		t.Fatalf("expected 0/0, got %d/%d", discovered, instrumented)
	}
}

func TestGetServicesReturnsSnapshot(t *testing.T) {
	eng := newTestEngine()
	eng.mu.Lock()
	eng.services["test-svc"] = &openlit.ServiceState{
		ID:                    "test-svc",
		ServiceName:           "test",
		WorkloadKey:           "test-svc",
		InstrumentationStatus: "discovered",
	}
	eng.mu.Unlock()

	services := eng.GetServices()
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}

	eng.mu.Lock()
	eng.services["test-svc-2"] = &openlit.ServiceState{
		ID:          "test-svc-2",
		ServiceName: "test2",
	}
	eng.mu.Unlock()

	if len(services) != 1 {
		t.Fatal("GetServices should return a snapshot, not a reference")
	}
}

func TestControllerCapabilitiesLinux(t *testing.T) {
	eng := newTestEngine()
	caps := eng.ControllerCapabilities()
	found := false
	for _, c := range caps {
		if c == "obi_llm_observability" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected obi_llm_observability capability")
	}
}

func TestInstrumentServiceUnknown(t *testing.T) {
	eng := newTestEngine()
	if err := eng.InstrumentService("nonexistent"); err == nil {
		t.Fatal("expected error for unknown service")
	}
}

func TestUninstrumentServiceUnknown(t *testing.T) {
	eng := newTestEngine()
	if err := eng.UninstrumentService("nonexistent"); err == nil {
		t.Fatal("expected error for unknown service")
	}
}

func TestServiceCountAfterAddingServices(t *testing.T) {
	eng := newTestEngine()
	eng.mu.Lock()
	eng.services["svc-a"] = &openlit.ServiceState{
		ID:                    "svc-a",
		ServiceName:           "a",
		InstrumentationStatus: "discovered",
	}
	eng.services["svc-b"] = &openlit.ServiceState{
		ID:                    "svc-b",
		ServiceName:           "b",
		InstrumentationStatus: "instrumented",
	}
	eng.mu.Unlock()

	discovered, instrumented := eng.ServiceCount()
	if discovered != 2 {
		t.Fatalf("expected 2 discovered, got %d", discovered)
	}
	if instrumented != 1 {
		t.Fatalf("expected 1 instrumented, got %d", instrumented)
	}
}
