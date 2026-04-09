package engine

import (
	"testing"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
)

func TestBuildWorkloadKeySeparatesKubernetesPods(t *testing.T) {
	first := &ProcessMetadata{
		Namespace:     "openlit",
		ServiceName:   "openai-app",
		PodUID:        "pod-a",
		ContainerName: "openai-app",
	}
	second := &ProcessMetadata{
		Namespace:     "openlit",
		ServiceName:   "openai-app",
		PodUID:        "pod-b",
		ContainerName: "openai-app",
	}

	if gotFirst, gotSecond := buildWorkloadKey(first, config.DeployKubernetes), buildWorkloadKey(second, config.DeployKubernetes); gotFirst == gotSecond {
		t.Fatalf("expected unique workload keys for separate pods, got %q", gotFirst)
	}
}

func TestBuildWorkloadKeySeparatesLinuxProcesses(t *testing.T) {
	first := &ProcessMetadata{
		PID:         101,
		ExePath:     "/usr/bin/python3",
		Cmdline:     "python -u app.py",
		ServiceName: "app.py",
	}
	second := &ProcessMetadata{
		PID:         202,
		ExePath:     "/usr/bin/python3",
		Cmdline:     "python -u app.py",
		ServiceName: "app.py",
	}

	if gotFirst, gotSecond := buildWorkloadKey(first, config.DeployLinux), buildWorkloadKey(second, config.DeployLinux); gotFirst == gotSecond {
		t.Fatalf("expected unique workload keys for separate linux processes, got %q", gotFirst)
	}
}

func TestDerivePatternUsesKubernetesPodSelectors(t *testing.T) {
	service := &openlit.ServiceState{
		ID: "svc-1",
		ResourceAttributes: map[string]string{
			"k8s.namespace.name": "openlit",
			"k8s.pod.name":       "openai-app-abc123",
		},
		PID: 1234,
	}

	pattern := derivePattern(service, config.DeployKubernetes)

	if pattern.K8sNamespace != "openlit" || pattern.K8sPodName != "openai-app-abc123" {
		t.Fatalf("expected kubernetes selectors to be used, got %+v", pattern)
	}
	if len(pattern.TargetPIDs) != 0 {
		t.Fatalf("expected kubernetes pod selector to avoid pid pinning, got %+v", pattern.TargetPIDs)
	}
}

func TestDerivePatternUsesTargetPIDForDockerAndLinux(t *testing.T) {
	service := &openlit.ServiceState{ID: "svc-2", PID: 4321}

	dockerPattern := derivePattern(service, config.DeployDocker)
	if len(dockerPattern.TargetPIDs) != 1 || dockerPattern.TargetPIDs[0] != 4321 || !dockerPattern.ContainersOnly {
		t.Fatalf("expected docker pattern to pin to pid and container scope, got %+v", dockerPattern)
	}

	linuxPattern := derivePattern(service, config.DeployLinux)
	if len(linuxPattern.TargetPIDs) != 1 || linuxPattern.TargetPIDs[0] != 4321 {
		t.Fatalf("expected linux pattern to pin to pid, got %+v", linuxPattern)
	}
}

func TestBuildInstrumentConfigEnablesOnlyDetectedProviders(t *testing.T) {
	cfg := BuildInstrumentConfig(
		"http://localhost:4318",
		nil,
		map[string]bool{
			"openai":  true,
			"bedrock": true,
		},
		config.DeployLinux,
		"default",
	)

	if !cfg.EBPF.PayloadExtraction.HTTP.GenAI.OpenAI.Enabled {
		t.Fatal("expected openai payload extraction to be enabled")
	}
	if !cfg.EBPF.PayloadExtraction.HTTP.GenAI.Bedrock.Enabled {
		t.Fatal("expected bedrock payload extraction to be enabled")
	}
	if cfg.EBPF.PayloadExtraction.HTTP.GenAI.Anthropic.Enabled {
		t.Fatal("expected anthropic payload extraction to remain disabled")
	}
	if cfg.EBPF.PayloadExtraction.HTTP.GenAI.Gemini.Enabled {
		t.Fatal("expected gemini payload extraction to remain disabled")
	}
}
