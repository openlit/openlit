//go:build !linux

package nic

import "log/slog"

func sampleIfaces(allow, exclude []string, rdmaEnabled bool, rdmaCounters []string, logger *slog.Logger) ([]IfaceSnapshot, error) {
	_ = allow
	_ = exclude
	_ = rdmaEnabled
	_ = rdmaCounters
	_ = logger
	return nil, nil
}
