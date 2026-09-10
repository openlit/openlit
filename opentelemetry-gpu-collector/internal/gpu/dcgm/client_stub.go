//go:build !linux || !(amd64 || arm64)

package dcgm

import (
	"log/slog"
	"time"
)

func newPlatformClient(libPath, address string, fields []uint16, interval time.Duration, logger *slog.Logger) (Client, error) {
	logger.Info("DCGM unavailable on this platform")
	return UnavailableClient{}, nil
}
