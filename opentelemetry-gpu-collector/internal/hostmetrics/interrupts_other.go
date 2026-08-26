//go:build !linux

package hostmetrics

import (
	"log/slog"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

// InterruptsCollector is a no-op on non-Linux platforms.
type InterruptsCollector struct{}

// NewInterruptsCollector soft-fails on non-Linux.
func NewInterruptsCollector(provider *sdkmetric.MeterProvider, logger *slog.Logger, perCPU bool) (*InterruptsCollector, error) {
	logger.Info("interrupts metrics unavailable on this platform")
	return &InterruptsCollector{}, nil
}

// Close is a no-op.
func (c *InterruptsCollector) Close() {}
