//go:build !linux || !(amd64 || arm64)

package rdc

import "log/slog"

func newPlatformClient(libPath string, logger *slog.Logger) (Client, error) {
	logger.Info("RDC unavailable on this platform")
	return UnavailableClient{}, nil
}
