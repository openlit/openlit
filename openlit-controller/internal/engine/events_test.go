package engine

import (
	"testing"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
)

func TestServiceIDKubernetes(t *testing.T) {
	meta := &ProcessMetadata{
		Namespace:      "default",
		ServiceName:    "myapp",
		DeploymentName: "myapp",
		PodName:        "myapp-abc-123",
		ContainerName:  "myapp",
	}
	id := serviceID(meta, config.DeployKubernetes)
	if id != "k8s:default:myapp:myapp" {
		t.Fatalf("expected k8s:default:myapp:myapp, got %q", id)
	}
}

func TestServiceIDDocker(t *testing.T) {
	meta := &ProcessMetadata{
		Namespace:     "default",
		ServiceName:   "myapp",
		ContainerID:   "abc123",
		ContainerName: "myapp",
	}
	id := serviceID(meta, config.DeployDocker)
	if id == "" {
		t.Fatal("expected non-empty service ID for docker")
	}
}

func TestServiceIDLinux(t *testing.T) {
	meta := &ProcessMetadata{
		Namespace:   "",
		ServiceName: "myapp",
		ExePath:     "/usr/bin/python3",
	}
	id := serviceID(meta, config.DeployLinux)
	if id == "" {
		t.Fatal("expected non-empty service ID for Linux")
	}
}

func TestServiceIDLinuxStable(t *testing.T) {
	meta := &ProcessMetadata{
		Namespace:   "",
		ServiceName: "myapp",
		ExePath:     "/usr/bin/python3",
	}
	id1 := serviceID(meta, config.DeployLinux)
	id2 := serviceID(meta, config.DeployLinux)
	if id1 != id2 {
		t.Fatalf("expected stable service ID, got %q vs %q", id1, id2)
	}
}

func TestAugmentServiceAttrsFromState(t *testing.T) {
	svc := &openlit.ServiceState{
		AgentObservabilityStatus: "enabled",
		AgentObservabilitySource: "controller_managed",
		ObservabilityConflict:    "",
		ObservabilityReason:      "test reason",
	}

	augmentServiceAttrsFromState(svc)

	if svc.ResourceAttributes["openlit.agent_observability.status"] != "enabled" {
		t.Errorf("expected enabled, got %q", svc.ResourceAttributes["openlit.agent_observability.status"])
	}
	if svc.ResourceAttributes["openlit.agent_observability.source"] != "controller_managed" {
		t.Errorf("expected controller_managed, got %q", svc.ResourceAttributes["openlit.agent_observability.source"])
	}
	if svc.ResourceAttributes["openlit.observability.reason"] != "test reason" {
		t.Errorf("expected 'test reason', got %q", svc.ResourceAttributes["openlit.observability.reason"])
	}
	if _, ok := svc.ResourceAttributes["openlit.observability.conflict"]; ok {
		t.Error("expected no conflict attribute when empty")
	}
}

func TestAugmentServiceAttrsInitializesMap(t *testing.T) {
	svc := &openlit.ServiceState{
		AgentObservabilityStatus: "disabled",
	}
	augmentServiceAttrsFromState(svc)
	if svc.ResourceAttributes == nil {
		t.Fatal("expected ResourceAttributes to be initialized")
	}
}

func TestApplyObservedAgentObservability(t *testing.T) {
	svc := &openlit.ServiceState{
		DesiredAgentObservabilityStatus: "error",
		DesiredAgentObservabilityReason: "something failed",
	}
	meta := &ProcessMetadata{
		AgentObservabilityStatus: "enabled",
		AgentObservabilitySource: "controller_managed",
	}

	applyObservedAgentObservability(svc, meta)

	if svc.AgentObservabilityStatus != "error" {
		t.Errorf("desired should take precedence, got %q", svc.AgentObservabilityStatus)
	}
	if svc.ObservabilityReason != "something failed" {
		t.Errorf("expected desired reason, got %q", svc.ObservabilityReason)
	}
}

func TestApplyObservedAgentObservabilityNoDesired(t *testing.T) {
	svc := &openlit.ServiceState{}
	meta := &ProcessMetadata{
		AgentObservabilityStatus: "enabled",
		AgentObservabilitySource: "existing_openlit",
		ObservabilityReason:      "detected",
	}

	applyObservedAgentObservability(svc, meta)

	if svc.AgentObservabilityStatus != "enabled" {
		t.Errorf("expected meta status, got %q", svc.AgentObservabilityStatus)
	}
	if svc.AgentObservabilitySource != "existing_openlit" {
		t.Errorf("expected meta source, got %q", svc.AgentObservabilitySource)
	}
}
