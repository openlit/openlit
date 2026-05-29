package engine

import (
	"strings"
	"testing"

	"github.com/openlit/openlit/openlit-controller/internal/openlit"
)

func TestEnsureDockerContainerManageableWithRestartPolicy(t *testing.T) {
	inspect := map[string]any{
		"HostConfig": map[string]any{
			"RestartPolicy": map[string]any{"Name": "always"},
		},
		"Config": map[string]any{
			"Labels": map[string]any{},
		},
	}
	if err := ensureDockerContainerManageable(inspect); err != nil {
		t.Fatalf("expected manageable with restart policy, got: %v", err)
	}
}

func TestEnsureDockerContainerManageableWithComposeLabels(t *testing.T) {
	inspect := map[string]any{
		"HostConfig": map[string]any{
			"RestartPolicy": map[string]any{"Name": "no"},
		},
		"Config": map[string]any{
			"Labels": map[string]any{
				"com.docker.compose.project": "myproject",
				"com.docker.compose.service": "myservice",
			},
		},
	}
	if err := ensureDockerContainerManageable(inspect); err != nil {
		t.Fatalf("expected manageable with compose labels, got: %v", err)
	}
}

func TestEnsureDockerContainerManageableRejectsUnsafe(t *testing.T) {
	inspect := map[string]any{
		"HostConfig": map[string]any{
			"RestartPolicy": map[string]any{"Name": "no"},
		},
		"Config": map[string]any{
			"Labels": map[string]any{},
		},
	}
	if err := ensureDockerContainerManageable(inspect); err == nil {
		t.Fatal("expected error for unmanageable container")
	}
}

func TestBuildDockerContainerCreatePayloadEnable(t *testing.T) {
	inspect := map[string]any{
		"Config": map[string]any{
			"Env":        []any{"FOO=bar"},
			"Image":      "python:3.12",
			"Cmd":        []any{"python", "app.py"},
			"Labels":     map[string]any{},
			"Entrypoint": []any{},
		},
		"HostConfig": map[string]any{
			"Binds": []any{},
		},
		"NetworkSettings": map[string]any{
			"Networks": map[string]any{},
		},
	}
	svc := &openlit.ServiceState{
		ServiceName: "test-svc",
		WorkloadKey: "docker:test-svc",
	}
	payload := openlit.PythonSDKActionPayload{
		OTLPEndpoint: "http://otel:4318",
	}

	result, err := buildDockerContainerCreatePayload(inspect, svc, payload, "openlit-vol", true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	envSlice := result["Env"].([]any)
	foundPythonPath := false
	foundControllerMode := false
	for _, e := range envSlice {
		s := e.(string)
		if strings.HasPrefix(s, "PYTHONPATH=") {
			foundPythonPath = true
		}
		if s == "OPENLIT_CONTROLLER_MODE=agent_observability" {
			foundControllerMode = true
		}
	}
	if !foundPythonPath {
		t.Error("expected PYTHONPATH in env")
	}
	if !foundControllerMode {
		t.Error("expected OPENLIT_CONTROLLER_MODE in env")
	}

	labels := result["Labels"].(map[string]string)
	if labels[openlitManagedLabel] != "true" {
		t.Error("expected openlit managed label")
	}
}

func TestBuildDockerContainerCreatePayloadDisable(t *testing.T) {
	inspect := map[string]any{
		"Config": map[string]any{
			"Env": []any{
				"FOO=bar",
				"OPENLIT_CONTROLLER_MODE=agent_observability",
			},
			"Image":      "python:3.12",
			"Cmd":        []any{"python", "app.py"},
			"Labels":     map[string]any{openlitManagedLabel: "true"},
			"Entrypoint": []any{},
		},
		"HostConfig": map[string]any{
			"Binds": []any{},
		},
		"NetworkSettings": map[string]any{
			"Networks": map[string]any{},
		},
	}
	svc := &openlit.ServiceState{
		ServiceName: "test-svc",
		WorkloadKey: "docker:test-svc",
	}

	result, err := buildDockerContainerCreatePayload(inspect, svc, openlit.PythonSDKActionPayload{}, "openlit-vol", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	envSlice := result["Env"].([]any)
	for _, e := range envSlice {
		s := e.(string)
		if strings.HasPrefix(s, "OPENLIT_CONTROLLER_MODE=") {
			t.Error("expected OPENLIT_CONTROLLER_MODE to be removed")
		}
	}
}

func TestBuildPyPIInstallShellCmd(t *testing.T) {
	cmd := buildPyPIInstallShellCmd("/opt/instrumentation", "1.2.3")
	if !strings.Contains(cmd, "1.2.3") {
		t.Errorf("expected version in command, got: %s", cmd)
	}
	if !strings.Contains(cmd, "/opt/instrumentation") {
		t.Errorf("expected mount path in command, got: %s", cmd)
	}
}

func TestBuildPyPIInstallShellCmdLatest(t *testing.T) {
	cmd := buildPyPIInstallShellCmd("/opt/instrumentation", "")
	if strings.Contains(cmd, "==") {
		t.Errorf("expected no version pin for empty version, got: %s", cmd)
	}
}

func TestDockerManagedPythonPath(t *testing.T) {
	env := []string{"PYTHONPATH=/existing/path"}
	got := dockerManagedPythonPath(env)
	if !strings.Contains(got, "/existing/path") {
		t.Errorf("expected existing path preserved, got: %s", got)
	}
	if !strings.Contains(got, openlitInstrumentationMountPath) {
		t.Errorf("expected managed path, got: %s", got)
	}
}

func TestDockerManagedPythonPathNoPrevious(t *testing.T) {
	got := dockerManagedPythonPath(nil)
	if !strings.Contains(got, openlitInstrumentationMountPath) {
		t.Errorf("expected managed path, got: %s", got)
	}
}
