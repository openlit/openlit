package main

import (
	"testing"

	"github.com/openlit/openlit/openlit-controller/internal/openlit"
)

func TestParsePythonSDKPayloadDefaults(t *testing.T) {
	payload, err := parsePythonSDKPayload("{}")
	if err != nil {
		t.Fatalf("expected defaults, got error: %v", err)
	}
	if payload.TargetRuntime != "python" {
		t.Fatalf("expected default target runtime, got %q", payload.TargetRuntime)
	}
	if payload.InstrumentationProfile != "controller_managed" {
		t.Fatalf("expected default instrumentation profile, got %q", payload.InstrumentationProfile)
	}
	if payload.DuplicatePolicy != "block_if_existing_otel_detected" {
		t.Fatalf("expected default duplicate policy, got %q", payload.DuplicatePolicy)
	}
	if payload.ObservabilityScope != "agent" {
		t.Fatalf("expected default observability scope, got %q", payload.ObservabilityScope)
	}
}

func TestParsePythonSDKPayloadRejectsInvalidJSON(t *testing.T) {
	if _, err := parsePythonSDKPayload("{"); err == nil {
		t.Fatal("expected invalid JSON payload to fail")
	}
}

func TestParsePythonSDKPayloadEmpty(t *testing.T) {
	payload, err := parsePythonSDKPayload("")
	if err != nil {
		t.Fatalf("expected defaults for empty string, got error: %v", err)
	}
	if payload.TargetRuntime != "python" {
		t.Fatalf("expected default runtime, got %q", payload.TargetRuntime)
	}
}

func TestParsePythonSDKPayloadWithOTLPEndpoint(t *testing.T) {
	payload, err := parsePythonSDKPayload(`{"otlp_endpoint":"http://otel:4318"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if payload.OTLPEndpoint != "http://otel:4318" {
		t.Errorf("expected otlp_endpoint, got %q", payload.OTLPEndpoint)
	}
	if payload.TargetRuntime != "python" {
		t.Errorf("defaults should fill in, got %q", payload.TargetRuntime)
	}
}

func TestBuildControllerResourceAttrsUsesModeSpecificCapabilities(t *testing.T) {
	attrs := buildControllerResourceAttrs(
		openlit.ModeDocker,
		"default",
		[]string{"obi_llm_observability", "python_sdk_injection_docker_v1"},
	)
	if attrs["controller.capabilities"] != "obi_llm_observability,python_sdk_injection_docker_v1" {
		t.Fatalf("unexpected controller capabilities value: %q", attrs["controller.capabilities"])
	}
}

func TestBuildControllerResourceAttrsKubernetes(t *testing.T) {
	t.Setenv("NODE_NAME", "test-node")
	t.Setenv("POD_NAME", "test-pod")
	t.Setenv("POD_NAMESPACE", "test-ns")

	attrs := buildControllerResourceAttrs(
		openlit.ModeKubernetes,
		"production",
		[]string{"obi_llm_observability"},
	)
	if attrs["k8s.node.name"] != "test-node" {
		t.Errorf("expected k8s.node.name=test-node, got %q", attrs["k8s.node.name"])
	}
	if attrs["k8s.pod.name"] != "test-pod" {
		t.Errorf("expected k8s.pod.name=test-pod, got %q", attrs["k8s.pod.name"])
	}
	if attrs["deployment.environment"] != "production" {
		t.Errorf("expected deployment.environment=production, got %q", attrs["deployment.environment"])
	}
}

func TestInstanceIDKubernetes(t *testing.T) {
	t.Setenv("NODE_NAME", "k8s-node-1")
	id := instanceID(openlit.ModeKubernetes)
	if id != "k8s-node-1" {
		t.Errorf("expected k8s-node-1, got %q", id)
	}
}

func TestInstanceIDLinuxFallsBackToHostname(t *testing.T) {
	id := instanceID(openlit.ModeLinux)
	if id == "" {
		t.Error("expected non-empty instance ID")
	}
}

func TestInstanceIDDocker(t *testing.T) {
	id := instanceID(openlit.ModeDocker)
	if id == "" {
		t.Error("expected non-empty instance ID")
	}
}

func TestExecuteActionUnknownType(t *testing.T) {
	eng := newNilEngine()
	action := openlit.PendingAction{
		ID:         "test-1",
		ActionType: "unknown_action",
		ServiceKey: "key",
	}
	result := executeAction(eng, action, testLogger())
	if result.Status != "failed" {
		t.Errorf("expected failed status for unknown action, got %q", result.Status)
	}
	if result.Error == "" {
		t.Error("expected error message for unknown action")
	}
}

func TestExecuteActionInstrumentUnknownService(t *testing.T) {
	eng := newNilEngine()
	action := openlit.PendingAction{
		ID:         "test-2",
		ActionType: "instrument",
		ServiceKey: "nonexistent",
	}
	result := executeAction(eng, action, testLogger())
	if result.Status != "failed" {
		t.Errorf("expected failed, got %q", result.Status)
	}
}
