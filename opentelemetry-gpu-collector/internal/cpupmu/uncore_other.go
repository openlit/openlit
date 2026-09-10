//go:build !linux

package cpupmu

import "log/slog"

func newUncoreReader(logger *slog.Logger) Reader {
	if logger != nil {
		logger.Debug("uncore memory bandwidth not supported on this platform")
	}
	return &UnavailableReader{}
}
