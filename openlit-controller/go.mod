module github.com/openlit/openlit/openlit-controller

go 1.24.0

require (
	github.com/cilium/ebpf v0.21.0
	go.uber.org/zap v1.27.0
	gopkg.in/yaml.v3 v3.0.1
)

require (
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/sys v0.37.0 // indirect
)

// When .obi-src/ submodule is checked out and vendor-providers has run:
// replace go.opentelemetry.io/obi => ./.obi-src
