package export

import (
	"context"
	"testing"

	sdkresource "go.opentelemetry.io/otel/sdk/resource"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/version"
)

func TestResourceAgentIdentityNoDefaultServiceName(t *testing.T) {
	t.Setenv("OTEL_SERVICE_NAME", "")
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "")

	cfg := &config.Config{
		ServiceName: "",
		Environment: "test",
	}

	attrs := agentResourceAttrs(cfg)
	m := map[string]string{}
	for _, a := range attrs {
		m[string(a.Key)] = a.Value.AsString()
	}
	if _, ok := m["service.name"]; ok {
		t.Fatalf("service.name should be omitted when unset, got %q", m["service.name"])
	}
	if m["telemetry.distro.name"] != version.DistroName {
		t.Fatalf("distro.name = %q", m["telemetry.distro.name"])
	}
	if m["telemetry.distro.version"] != version.Version {
		t.Fatalf("distro.version = %q", m["telemetry.distro.version"])
	}
	if m["deployment.environment"] != "test" {
		t.Fatalf("environment = %q", m["deployment.environment"])
	}

	res, err := sdkresource.New(context.Background(),
		sdkresource.WithTelemetrySDK(),
		sdkresource.WithAttributes(attrs...),
	)
	if err != nil {
		t.Fatal(err)
	}
	foundSDK := false
	for _, a := range res.Attributes() {
		if string(a.Key) == "telemetry.sdk.language" && a.Value.AsString() == "go" {
			foundSDK = true
		}
	}
	if !foundSDK {
		t.Fatal("expected telemetry.sdk.language=go from WithTelemetrySDK")
	}
}

func TestResourceOptionalServiceName(t *testing.T) {
	attrs := agentResourceAttrs(&config.Config{ServiceName: "backend-required", Environment: "prod"})
	found := false
	for _, a := range attrs {
		if string(a.Key) == "service.name" && a.Value.AsString() == "backend-required" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected explicit service.name")
	}
}
