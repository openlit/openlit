package main

import (
	"os"
	"path/filepath"
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

func TestInstanceIDEnvOverride(t *testing.T) {
	t.Setenv("OPENLIT_INSTANCE_ID", "custom-id-42")
	for _, mode := range []openlit.ControllerMode{openlit.ModeLinux, openlit.ModeDocker, openlit.ModeKubernetes} {
		id := instanceID(mode)
		if id != "custom-id-42" {
			t.Errorf("mode %s: expected custom-id-42, got %q", mode, id)
		}
	}
}

func TestInstanceIDKubernetes(t *testing.T) {
	t.Setenv("NODE_NAME", "k8s-node-1")
	id := instanceID(openlit.ModeKubernetes)
	if id != "k8s-node-1" {
		t.Errorf("expected k8s-node-1, got %q", id)
	}
}

func TestInstanceIDKubernetesEnvTakesPriority(t *testing.T) {
	t.Setenv("OPENLIT_INSTANCE_ID", "override")
	t.Setenv("NODE_NAME", "k8s-node-1")
	id := instanceID(openlit.ModeKubernetes)
	if id != "override" {
		t.Errorf("expected OPENLIT_INSTANCE_ID to take priority, got %q", id)
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

func TestProcHostHostname(t *testing.T) {
	tmpDir := t.TempDir()
	sysDir := filepath.Join(tmpDir, "sys", "kernel")
	if err := os.MkdirAll(sysDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sysDir, "hostname"), []byte("my-docker-host\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENLIT_PROC_ROOT", tmpDir)

	name, err := procHostHostname()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if name != "my-docker-host" {
		t.Errorf("expected my-docker-host, got %q", name)
	}
}

func TestDockerStableIDReturnsNonEmpty(t *testing.T) {
	tmpDir := t.TempDir()
	sysDir := filepath.Join(tmpDir, "sys", "kernel")
	if err := os.MkdirAll(sysDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sysDir, "hostname"), []byte("my-docker-host\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENLIT_PROC_ROOT", tmpDir)

	id, err := dockerStableID()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty docker stable ID")
	}
}

func TestProcHostHostnameMissingFile(t *testing.T) {
	t.Setenv("OPENLIT_PROC_ROOT", t.TempDir())
	_, err := procHostHostname()
	if err == nil {
		t.Error("expected error when hostname file is missing")
	}
}

func TestProcHostHostnameEmpty(t *testing.T) {
	tmpDir := t.TempDir()
	sysDir := filepath.Join(tmpDir, "sys", "kernel")
	if err := os.MkdirAll(sysDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sysDir, "hostname"), []byte("  \n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENLIT_PROC_ROOT", tmpDir)

	name, err := procHostHostname()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if name != "" {
		t.Errorf("expected empty string for whitespace-only hostname, got %q", name)
	}
}

func TestDockerStableIDDeterministic(t *testing.T) {
	tmpDir := t.TempDir()
	sysDir := filepath.Join(tmpDir, "sys", "kernel")
	if err := os.MkdirAll(sysDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sysDir, "hostname"), []byte("stable-host\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENLIT_PROC_ROOT", tmpDir)

	id1, _ := dockerStableID()
	id2, _ := dockerStableID()
	if id1 != id2 {
		t.Errorf("expected deterministic results, got %q and %q", id1, id2)
	}
}

func TestInstanceIDDockerWithProcRoot(t *testing.T) {
	tmpDir := t.TempDir()
	sysDir := filepath.Join(tmpDir, "sys", "kernel")
	if err := os.MkdirAll(sysDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sysDir, "hostname"), []byte("docker-host\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENLIT_PROC_ROOT", tmpDir)

	id := instanceID(openlit.ModeDocker)
	if id == "" {
		t.Error("expected non-empty instance ID")
	}
	if len(id) < len("docker-host") {
		t.Errorf("expected ID starting with docker-host, got %q", id)
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
