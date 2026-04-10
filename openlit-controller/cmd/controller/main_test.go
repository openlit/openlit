package main

import "testing"

import "github.com/openlit/openlit/openlit-controller/internal/openlit"

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
