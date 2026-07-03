package engine

import (
	"strings"
	"testing"

	"github.com/openlit/openlit/openlit-controller/internal/openlit"
)

func TestEvaluateNodeJSSDKPreflight(t *testing.T) {
	tests := []struct {
		name     string
		command  []string
		env      map[string]string
		decision pythonSDKDecision
		source   string
	}{
		{
			name:     "plain node app applies controller sdk",
			command:  []string{"node", "server.js"},
			env:      map[string]string{},
			decision: pythonSDKDecisionApply,
			source:   "controller_managed",
		},
		{
			name:     "controller managed node options adopts",
			command:  []string{"node", "server.js"},
			env:      map[string]string{"NODE_OPTIONS": "--require /instrumentation-packages/node-sdk/node_modules/openlit/dist/register.js"},
			decision: pythonSDKDecisionAdopt,
			source:   "controller_managed",
		},
		{
			name:     "manual openlit register adopts",
			command:  []string{"node", "--require", "openlit/register", "server.js"},
			env:      map[string]string{},
			decision: pythonSDKDecisionAdopt,
			source:   "existing_openlit",
		},
		{
			name:     "otel auto instrumentation blocks",
			command:  []string{"node", "server.js"},
			env:      map[string]string{"NODE_OPTIONS": "--require=@opentelemetry/auto-instrumentations-node/register"},
			decision: pythonSDKDecisionBlock,
			source:   "existing_otel",
		},
		{
			name:     "otel sdk shorthand blocks",
			command:  []string{"node", "-r", "@opentelemetry/sdk-node", "server.js"},
			env:      map[string]string{},
			decision: pythonSDKDecisionBlock,
			source:   "existing_otel",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := evaluateNodeJSSDKPreflight(tt.env, tt.command, defaultDuplicatePolicy)
			if got.Decision != tt.decision || got.Source != tt.source {
				t.Fatalf("expected %s/%s, got %+v", tt.decision, tt.source, got)
			}
		})
	}
}

func TestNodeRequireOptionMergeAndRemove(t *testing.T) {
	const registerPath = "/opt/openlit/node_modules/openlit/dist/register.js"
	got := prependNodeRequireOption("--inspect=0.0.0.0:9229 -r ./user-hook.js", registerPath)
	if got != "--require "+registerPath+" --inspect=0.0.0.0:9229 -r ./user-hook.js" {
		t.Fatalf("unexpected NODE_OPTIONS merge: %q", got)
	}
	if again := prependNodeRequireOption(got, registerPath); again != got {
		t.Fatalf("expected idempotent merge, got %q", again)
	}
	removed := removeNodeRequireOption(got, registerPath)
	if removed != "--inspect=0.0.0.0:9229 -r ./user-hook.js" {
		t.Fatalf("unexpected NODE_OPTIONS removal: %q", removed)
	}
}

func TestBuildNodeJSSDKWorkloadPatch(t *testing.T) {
	workload := map[string]any{
		"spec": map[string]any{
			"template": map[string]any{
				"metadata": map[string]any{"annotations": map[string]any{}},
				"spec": map[string]any{
					"containers": []any{
						map[string]any{
							"name":  "app",
							"image": "node:20-alpine",
							"env": []any{
								map[string]any{"name": "NODE_OPTIONS", "value": "--max-old-space-size=512"},
							},
						},
					},
				},
			},
		},
	}
	svc := &openlit.ServiceState{
		ID:          "svc-node",
		ServiceName: "node-demo",
		WorkloadKey: "k8s:default:deployment/node-demo",
	}
	payload := openlit.SDKActionPayload{
		TargetRuntime: "nodejs",
		OTLPEndpoint:  "http://otel:4318",
		Environment:   "prod",
	}

	patch, err := buildNodeJSSDKWorkloadPatch(workload, "app", svc, payload, true)
	if err != nil {
		t.Fatalf("enable patch failed: %v", err)
	}
	template := patch["spec"].(map[string]any)["template"].(map[string]any)
	templateSpec := template["spec"].(map[string]any)
	containers := extractObjectSlice(templateSpec["containers"])
	env := extractContainerEnv(containers[0])
	if !strings.HasPrefix(env["NODE_OPTIONS"], "--require /instrumentation-packages/node-sdk/node_modules/openlit/dist/register.js ") {
		t.Fatalf("expected managed register in NODE_OPTIONS, got %q", env["NODE_OPTIONS"])
	}
	if !strings.Contains(env["NODE_OPTIONS"], "--max-old-space-size=512") {
		t.Fatalf("expected user NODE_OPTIONS preserved, got %q", env["NODE_OPTIONS"])
	}
	if env["OTEL_SERVICE_NAME"] != "node-demo" || env["OTEL_EXPORTER_OTLP_ENDPOINT"] != "http://otel:4318" {
		t.Fatalf("expected common OTLP env, got %+v", env)
	}
	if !strings.Contains(env["OPENLIT_DISABLED_INSTRUMENTORS"], "openai") || strings.Contains(env["OPENLIT_DISABLED_INSTRUMENTORS"], "langchain") {
		t.Fatalf("expected direct-client disabled list without agent framework instrumentors, got %q", env["OPENLIT_DISABLED_INSTRUMENTORS"])
	}
	initContainers := extractObjectSlice(templateSpec["initContainers"])
	if len(initContainers) != 1 {
		t.Fatalf("expected init container")
	}
	initCmd := extractStringSlice(initContainers[0]["command"])
	if len(initCmd) < 3 || !strings.Contains(initCmd[2], "npm install") || !strings.Contains(initCmd[2], "openlit") {
		t.Fatalf("expected npm install openlit command, got %v", initCmd)
	}

	disablePatch, err := buildNodeJSSDKWorkloadPatch(patch, "app", svc, payload, false)
	if err != nil {
		t.Fatalf("disable patch failed: %v", err)
	}
	disableSpec := disablePatch["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)
	disableEnv := extractContainerEnv(extractObjectSlice(disableSpec["containers"])[0])
	if strings.Contains(disableEnv["NODE_OPTIONS"], "openlit") {
		t.Fatalf("expected managed register removed, got %q", disableEnv["NODE_OPTIONS"])
	}
	if disableEnv["NODE_OPTIONS"] != "--max-old-space-size=512" {
		t.Fatalf("expected user NODE_OPTIONS preserved, got %q", disableEnv["NODE_OPTIONS"])
	}
	if _, ok := disableEnv["OPENLIT_CONTROLLER_MODE"]; ok {
		t.Fatalf("expected common SDK env removed, got %+v", disableEnv)
	}
}

func TestBuildDockerNodeJSContainerCreatePayload(t *testing.T) {
	inspect := map[string]any{
		"Config": map[string]any{
			"Env":    []any{"NODE_OPTIONS=--trace-warnings"},
			"Image":  "node:20",
			"Cmd":    []any{"node", "server.js"},
			"Labels": map[string]any{},
		},
		"HostConfig": map[string]any{"Binds": []any{}},
	}
	svc := &openlit.ServiceState{
		ID:          "docker:node-demo",
		WorkloadKey: "docker:node-demo",
		ServiceName: "node-demo",
	}
	payload := openlit.SDKActionPayload{TargetRuntime: "nodejs", OTLPEndpoint: "http://otel:4318"}
	result, err := buildDockerNodeJSContainerCreatePayload(inspect, svc, payload, "openlit-nodejs-sdk-abc", true)
	if err != nil {
		t.Fatalf("build docker payload failed: %v", err)
	}
	env := strings.Join(extractStringList(result["Env"]), "\n")
	if !strings.Contains(env, "NODE_OPTIONS=--require /instrumentation-packages/node-sdk/node_modules/openlit/dist/register.js --trace-warnings") {
		t.Fatalf("expected managed NODE_OPTIONS with user flags preserved, got %s", env)
	}
	if !strings.Contains(env, "OPENLIT_CONTROLLER_MODE=agent_observability") {
		t.Fatalf("expected controller mode env, got %s", env)
	}
	hostConfig := result["HostConfig"].(map[string]any)
	binds := extractStringList(hostConfig["Binds"])
	if len(binds) != 1 || binds[0] != "openlit-nodejs-sdk-abc:/instrumentation-packages" {
		t.Fatalf("expected instrumentation bind mount, got %v", binds)
	}
}

func TestBuildNodeSystemdDropInContent(t *testing.T) {
	content := buildNodeSystemdDropInContent(
		"node-ai.service",
		"/var/lib/openlit/nodejs-sdk/node-ai.service",
		"node-ai",
		"linux:systemd:node-ai.service",
		openlit.SDKActionPayload{
			OTLPEndpoint: "http://otel:4318",
			Environment:  "production",
		},
		"openai,anthropic",
		"--trace-warnings",
		"abc123",
	)

	if !strings.Contains(content, "NODE_OPTIONS=--require /var/lib/openlit/nodejs-sdk/node-ai.service/node_modules/openlit/dist/register.js --trace-warnings") {
		t.Fatalf("expected managed NODE_OPTIONS with existing flags preserved, got %s", content)
	}
	if !strings.Contains(content, "OTEL_SERVICE_NAME=node-ai") {
		t.Fatalf("expected service name, got %s", content)
	}
	if !strings.Contains(content, "OTEL_RESOURCE_ATTRIBUTES=service.workload.key=linux:systemd:node-ai.service") {
		t.Fatalf("expected workload resource attr, got %s", content)
	}
	if !strings.Contains(content, "OPENLIT_DISABLED_INSTRUMENTORS=openai,anthropic") {
		t.Fatalf("expected disabled instrumentors, got %s", content)
	}
}

func TestNormalizeSDKPayloadRuntimeVersionSelection(t *testing.T) {
	eng := newTestEngine()
	eng.sdkVersion = "1.34.0"     // PyPI version
	eng.nodeSDKVersion = "1.13.0" // independent npm version

	// Node target must take the npm-side default, never the PyPI version.
	nodePayload := eng.normalizeSDKPayload(openlit.SDKActionPayload{TargetRuntime: "nodejs"}, "python")
	if nodePayload.SDKVersion != "1.13.0" {
		t.Fatalf("expected node payload to use nodeSDKVersion, got %q", nodePayload.SDKVersion)
	}

	// Python target keeps the PyPI default.
	pyPayload := eng.normalizeSDKPayload(openlit.SDKActionPayload{TargetRuntime: "python"}, "python")
	if pyPayload.SDKVersion != "1.34.0" {
		t.Fatalf("expected python payload to use sdkVersion, got %q", pyPayload.SDKVersion)
	}

	// An explicit version is always respected and never overridden by defaults.
	pinned := eng.normalizeSDKPayload(openlit.SDKActionPayload{TargetRuntime: "nodejs", SDKVersion: "2.0.0"}, "python")
	if pinned.SDKVersion != "2.0.0" {
		t.Fatalf("expected explicit version preserved, got %q", pinned.SDKVersion)
	}
}

func TestDetectAgentObservabilityNodeJS(t *testing.T) {
	status, source, conflict, reason := detectAgentObservability("nodejs", "node server.js", map[string]string{})
	if status != "disabled" || source != "none" || conflict != "" || !strings.Contains(reason, "JavaScript/TypeScript") {
		t.Fatalf("unexpected default node observability state: %s %s %s %q", status, source, conflict, reason)
	}
	status, source, conflict, _ = detectAgentObservability("nodejs", "node server.js", map[string]string{
		"NODE_OPTIONS": "--require /instrumentation-packages/node-sdk/node_modules/openlit/dist/register.js",
	})
	if status != "enabled" || source != "controller_managed" || conflict != "" {
		t.Fatalf("expected controller-managed node sdk detection, got %s %s %s", status, source, conflict)
	}
}
