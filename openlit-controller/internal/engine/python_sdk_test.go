package engine

import (
	"strings"
	"testing"

	"github.com/openlit/openlit/openlit-controller/internal/openlit"
)

func TestDetectAgentObservability(t *testing.T) {
	status, source, conflict, reason := detectAgentObservability(
		"python",
		"python app.py",
		map[string]string{},
	)
	if status != "disabled" || source != "none" || conflict != "" {
		t.Fatalf("unexpected default observability state: %s %s %s", status, source, conflict)
	}
	if reason == "" {
		t.Fatal("expected a human-readable reason for Python runtime")
	}

	status, source, conflict, _ = detectAgentObservability(
		"python",
		"python app.py",
		map[string]string{
			"OPENLIT_CONTROLLER_MODE": "agent_observability",
		},
	)
	if status != "enabled" || source != "controller_managed" || conflict != "" {
		t.Fatalf("expected controller-managed SDK detection, got %s %s %s", status, source, conflict)
	}

	status, source, conflict, _ = detectAgentObservability(
		"python",
		"opentelemetry-instrument python app.py",
		map[string]string{},
	)
	if status != "disabled" || source != "existing_otel" || conflict != "existing_otel" {
		t.Fatalf("expected existing OTel conflict, got %s %s %s", status, source, conflict)
	}
}

func TestEvaluatePythonSDKPreflightAdoptsExistingOpenLIT(t *testing.T) {
	result := evaluatePythonSDKPreflight(
		map[string]string{
			"OPENLIT_DISABLED_INSTRUMENTORS": "openai",
		},
		[]string{"python", "app.py"},
		"block_if_existing_otel_detected",
	)
	if result.Decision != pythonSDKDecisionAdopt || result.Source != "existing_openlit" {
		t.Fatalf("expected existing OpenLIT adoption, got %+v", result)
	}
}

func TestEvaluatePythonSDKPreflightBlocksExistingOTel(t *testing.T) {
	result := evaluatePythonSDKPreflight(
		map[string]string{
			"OTEL_PYTHON_DISTRO": "opentelemetry-distro",
		},
		[]string{"python", "app.py"},
		"block_if_existing_otel_detected",
	)
	if result.Decision != pythonSDKDecisionBlock || result.Conflict != "existing_otel" {
		t.Fatalf("expected existing OpenTelemetry block, got %+v", result)
	}
}

func TestBuildPythonSDKWorkloadPatch(t *testing.T) {
	workload := map[string]any{
		"spec": map[string]any{
			"template": map[string]any{
				"metadata": map[string]any{
					"annotations": map[string]any{},
				},
				"spec": map[string]any{
					"containers": []any{
						map[string]any{
							"name":  "app",
							"image": "my-python-app:latest",
							"env": []any{
								map[string]any{
									"name":  "PYTHONPATH",
									"value": "/app",
								},
							},
						},
					},
				},
			},
		},
	}

	service := &openlit.ServiceState{
		ID:          "svc-1",
		ServiceName: "demo",
	}
	payload := openlit.PythonSDKActionPayload{
		TargetRuntime:          "python",
		InstrumentationProfile: "controller_managed",
		DuplicatePolicy:        "block_if_existing_otel_detected",
		ObservabilityScope:     "agent",
		OTLPEndpoint:           "http://otel-collector:4318",
	}

	enablePatch, err := buildPythonSDKWorkloadPatch(workload, "app", service, payload, true)
	if err != nil {
		t.Fatalf("enable patch failed: %v", err)
	}

	spec := enablePatch["spec"].(map[string]any)
	template := spec["template"].(map[string]any)
	templateSpec := template["spec"].(map[string]any)
	containers := extractObjectSlice(templateSpec["containers"])
	env := extractContainerEnv(containers[0])
	if env["OPENLIT_CONTROLLER_MODE"] != "agent_observability" {
		t.Fatalf("expected controller mode env, got %+v", env)
	}
	if env["OTEL_EXPORTER_OTLP_ENDPOINT"] != "http://otel-collector:4318" {
		t.Fatalf("expected OTLP endpoint env, got %+v", env)
	}
	expectedPythonPath := "/instrumentation-packages/bootstrap:/instrumentation-packages/packages:/app"
	if env["PYTHONPATH"] != expectedPythonPath {
		t.Fatalf("expected prefixed PYTHONPATH %q, got %q", expectedPythonPath, env["PYTHONPATH"])
	}

	initContainers := extractObjectSlice(templateSpec["initContainers"])
	if len(initContainers) != 1 {
		t.Fatalf("expected init container to be injected")
	}
	initImage, _ := initContainers[0]["image"].(string)
	if initImage != "my-python-app:latest" {
		t.Fatalf("expected init container to use app image, got %q", initImage)
	}
	initCmd := extractStringSlice(initContainers[0]["command"])
	if len(initCmd) < 3 || initCmd[0] != "sh" || initCmd[1] != "-c" {
		t.Fatalf("expected init container command to be [sh -c ...], got %v", initCmd)
	}
	if !strings.Contains(initCmd[2], "pip install") || !strings.Contains(initCmd[2], "openlit") {
		t.Fatalf("expected init container command to contain pip install openlit, got %q", initCmd[2])
	}

	if len(extractObjectSlice(templateSpec["volumes"])) != 1 {
		t.Fatalf("expected instrumentation volume to be injected")
	}

	metaAnnotations := template["metadata"].(map[string]any)["annotations"]
	switch ann := metaAnnotations.(type) {
	case map[string]string:
		if ann[openlitManagedSDKVersion] != "latest" {
			t.Fatalf("expected sdk version annotation 'latest', got %v", ann[openlitManagedSDKVersion])
		}
	case map[string]any:
		if ann[openlitManagedSDKVersion] != "latest" {
			t.Fatalf("expected sdk version annotation 'latest', got %v", ann[openlitManagedSDKVersion])
		}
	default:
		t.Fatalf("unexpected annotations type %T", metaAnnotations)
	}

	disablePatch, err := buildPythonSDKWorkloadPatch(workload, "app", service, payload, false)
	if err != nil {
		t.Fatalf("disable patch failed: %v", err)
	}
	disableSpec := disablePatch["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)
	disableContainers := extractObjectSlice(disableSpec["containers"])
	disableEnv := extractContainerEnv(disableContainers[0])
	if _, ok := disableEnv["OPENLIT_CONTROLLER_MODE"]; ok {
		t.Fatalf("expected controller mode env to be removed: %+v", disableEnv)
	}
}

func TestBuildDockerContainerCreatePayload(t *testing.T) {
	inspect := map[string]any{
		"Name": "demo-app",
		"Config": map[string]any{
			"Image": "python:3.11-slim",
			"Env": []any{
				"PYTHONPATH=/app",
			},
			"Labels": map[string]any{},
			"Cmd":    []any{"python", "app.py"},
		},
		"HostConfig": map[string]any{
			"Binds": []any{"/tmp/data:/data"},
			"RestartPolicy": map[string]any{
				"Name": "always",
			},
		},
	}
	svc := &openlit.ServiceState{
		ID:          "docker:demo-app",
		WorkloadKey: "docker:demo-app",
		ServiceName: "demo-app",
	}
	payload := openlit.PythonSDKActionPayload{
		TargetRuntime:          "python",
		InstrumentationProfile: "controller_managed",
		DuplicatePolicy:        "block_if_existing_otel_detected",
		ObservabilityScope:     "agent",
		OTLPEndpoint:           "http://otel-collector:4318",
	}

	createPayload, err := buildDockerContainerCreatePayload(inspect, svc, payload, "openlit-python-sdk-abc", true)
	if err != nil {
		t.Fatalf("build docker payload failed: %v", err)
	}
	env := extractStringList(createPayload["Env"])
	joinedEnv := strings.Join(env, "\n")
	if !strings.Contains(joinedEnv, "OPENLIT_CONTROLLER_MODE=agent_observability") {
		t.Fatalf("expected controller mode env, got %v", env)
	}
	if !strings.Contains(joinedEnv, "PYTHONPATH=/instrumentation-packages/bootstrap:/instrumentation-packages/packages:/app") {
		t.Fatalf("expected managed python path, got %v", env)
	}
	hostConfig := createPayload["HostConfig"].(map[string]any)
	binds := extractStringList(hostConfig["Binds"])
	if len(binds) != 2 || binds[1] != "openlit-python-sdk-abc:/instrumentation-packages" {
		t.Fatalf("expected instrumentation bind mount, got %v", binds)
	}
	labels := extractStringMap(createPayload["Labels"])
	if labels[openlitManagedLabel] != "true" {
		t.Fatalf("expected managed docker label, got %v", labels)
	}
}
