package engine

import (
	"strings"
	"testing"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
)

func TestBuildWorkloadKeyStableForSameDeployment(t *testing.T) {
	first := &ProcessMetadata{
		Namespace:      "openlit",
		ServiceName:    "openai-app",
		DeploymentName: "openai-app",
		PodName:        "openai-app-abc-111",
		ContainerName:  "openai-app",
	}
	second := &ProcessMetadata{
		Namespace:      "openlit",
		ServiceName:    "openai-app",
		DeploymentName: "openai-app",
		PodName:        "openai-app-abc-222",
		ContainerName:  "openai-app",
	}

	gotFirst := buildWorkloadKey(first, config.DeployKubernetes)
	gotSecond := buildWorkloadKey(second, config.DeployKubernetes)
	if gotFirst != gotSecond {
		t.Fatalf("expected same workload key for pods in same deployment, got %q vs %q", gotFirst, gotSecond)
	}
	if gotFirst != "k8s:openlit:openai-app:openai-app" {
		t.Fatalf("expected k8s:openlit:openai-app:openai-app, got %q", gotFirst)
	}
}

func TestBuildWorkloadKeyStableForNakedPods(t *testing.T) {
	meta := &ProcessMetadata{
		Namespace:   "openlit",
		ServiceName: "gemini-app",
		PodName:     "gemini-app",
		PodUID:      "some-uid-123",
	}

	got := buildWorkloadKey(meta, config.DeployKubernetes)
	if got != "k8s:openlit:gemini-app:gemini-app" {
		t.Fatalf("expected stable key using pod name, got %q", got)
	}
}

func TestBuildWorkloadKeySeparatesNamespaces(t *testing.T) {
	first := &ProcessMetadata{
		Namespace:      "team-a",
		ServiceName:    "app",
		DeploymentName: "app",
		ContainerName:  "app",
	}
	second := &ProcessMetadata{
		Namespace:      "team-b",
		ServiceName:    "app",
		DeploymentName: "app",
		ContainerName:  "app",
	}

	if gotFirst, gotSecond := buildWorkloadKey(first, config.DeployKubernetes), buildWorkloadKey(second, config.DeployKubernetes); gotFirst == gotSecond {
		t.Fatalf("expected different keys for different namespaces, got %q", gotFirst)
	}
}

func TestBuildWorkloadKeyStableAcrossRestarts(t *testing.T) {
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

	gotFirst := buildWorkloadKey(first, config.DeployLinux)
	gotSecond := buildWorkloadKey(second, config.DeployLinux)
	if gotFirst != gotSecond {
		t.Fatalf("expected same workload key for same exe+cmdline across PIDs, got %q vs %q", gotFirst, gotSecond)
	}
	if !strings.HasPrefix(gotFirst, "linux:exe:") {
		t.Fatalf("expected linux:exe: prefix, got %q", gotFirst)
	}
}

func TestBuildWorkloadKeySeparatesDifferentLinuxApps(t *testing.T) {
	first := &ProcessMetadata{
		PID:         101,
		ExePath:     "/usr/bin/python3",
		Cmdline:     "python -u app.py",
		ServiceName: "app.py",
	}
	second := &ProcessMetadata{
		PID:         202,
		ExePath:     "/usr/bin/python3",
		Cmdline:     "python -u worker.py",
		ServiceName: "worker.py",
	}

	if gotFirst, gotSecond := buildWorkloadKey(first, config.DeployLinux), buildWorkloadKey(second, config.DeployLinux); gotFirst == gotSecond {
		t.Fatalf("expected different workload keys for different apps, got %q", gotFirst)
	}
}

func TestBuildWorkloadKeyUsesStableDockerContainerName(t *testing.T) {
	meta := &ProcessMetadata{
		ContainerID:   "1234567890abcdef",
		ContainerName: "openai-app-dev",
	}

	got := buildWorkloadKey(meta, config.DeployDocker)
	if got != "docker:openai-app-dev" {
		t.Fatalf("expected stable docker workload key by container name, got %q", got)
	}
}

func TestBuildWorkloadKeyUsesStableSystemdUnit(t *testing.T) {
	meta := &ProcessMetadata{
		PID:         101,
		ExePath:     "/usr/bin/python3",
		Cmdline:     "python -u app.py",
		ServiceName: "app.py",
		SystemdUnit: "openai-agent.service",
	}

	got := buildWorkloadKey(meta, config.DeployLinux)
	if got != "linux:systemd:openai-agent.service" {
		t.Fatalf("expected stable systemd workload key, got %q", got)
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

func TestDerivePatternUsesDaemonSetSelector(t *testing.T) {
	service := &openlit.ServiceState{
		ID:             "svc-ds",
		DeploymentName: "bedrock-app",
		ResourceAttributes: map[string]string{
			"k8s.namespace.name": "openlit",
			"k8s.workload.kind":  "DaemonSet",
			"k8s.pod.name":       "bedrock-app-abc",
		},
	}

	pattern := derivePattern(service, config.DeployKubernetes)
	if pattern.K8sDaemonSet != "bedrock-app" {
		t.Fatalf("expected K8sDaemonSet=bedrock-app, got %+v", pattern)
	}
	if pattern.K8sDeployment != "" {
		t.Fatalf("expected K8sDeployment to be empty for DaemonSet, got %q", pattern.K8sDeployment)
	}
}

func TestDerivePatternUsesStatefulSetSelector(t *testing.T) {
	service := &openlit.ServiceState{
		ID:             "svc-sts",
		DeploymentName: "redis",
		ResourceAttributes: map[string]string{
			"k8s.namespace.name": "openlit",
			"k8s.workload.kind":  "StatefulSet",
			"k8s.pod.name":       "redis-0",
		},
	}

	pattern := derivePattern(service, config.DeployKubernetes)
	if pattern.K8sStatefulSet != "redis" {
		t.Fatalf("expected K8sStatefulSet=redis, got %+v", pattern)
	}
	if pattern.K8sDeployment != "" {
		t.Fatalf("expected K8sDeployment to be empty for StatefulSet, got %q", pattern.K8sDeployment)
	}
}

func TestDerivePatternUsesDeploymentSelector(t *testing.T) {
	service := &openlit.ServiceState{
		ID:             "svc-dep",
		DeploymentName: "crewai-agent-app",
		ResourceAttributes: map[string]string{
			"k8s.namespace.name": "openlit",
			"k8s.workload.kind":  "Deployment",
			"k8s.pod.name":       "crewai-agent-app-abc-123",
		},
	}

	pattern := derivePattern(service, config.DeployKubernetes)
	if pattern.K8sDeployment != "crewai-agent-app" {
		t.Fatalf("expected K8sDeployment=crewai-agent-app, got %+v", pattern)
	}
	if pattern.K8sDaemonSet != "" || pattern.K8sStatefulSet != "" {
		t.Fatalf("expected DaemonSet/StatefulSet to be empty for Deployment, got ds=%q sts=%q", pattern.K8sDaemonSet, pattern.K8sStatefulSet)
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
