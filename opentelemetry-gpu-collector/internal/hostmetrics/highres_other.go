//go:build !linux

package hostmetrics

import "log/slog"

// NewHighResCPU is a no-op on non-Linux platforms.
func NewHighResCPU(logger *slog.Logger) (*HighResCPU, error) {
	if logger != nil {
		logger.Info("high-res CPU sampler unavailable on this platform")
	}
	return nil, nil
}
