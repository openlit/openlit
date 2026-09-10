// Package version holds the OpenLIT GPU metrics agent build identity.
// Override at link time:
//
//	go build -ldflags "-X github.com/openlit/openlit/opentelemetry-gpu-collector/internal/version.Version=1.2.3"
package version

// Version is the agent release version (semver or git describe).
var Version = "0.1.0"

// DistroName is the telemetry.distro.name resource attribute.
// This agent is not an application "service"; product identity lives here.
const DistroName = "opentelemetry-gpu-collector"
