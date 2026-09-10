//go:build !linux

package cpupmu

import "log/slog"

func newPlatformReader(specs []EventSpec, logger *slog.Logger) Reader {
	_ = specs
	if logger != nil {
		logger.Info("CPU PMU not available on this platform")
	}
	return &UnavailableReader{}
}
