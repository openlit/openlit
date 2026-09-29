package rdc

import "log/slog"

// Client samples AMD RDC metrics. Soft-fails when librdc is missing.
type Client interface {
	Sample() ([]Sample, error)
	Close() error
	Available() bool
}

// UnavailableClient is a no-op Client used when librdc is missing or init fails.
type UnavailableClient struct{}

// Sample returns no samples.
func (UnavailableClient) Sample() ([]Sample, error) { return nil, nil }

// Close is a no-op.
func (UnavailableClient) Close() error { return nil }

// Available reports false.
func (UnavailableClient) Available() bool { return false }

// NewClient attempts to load and initialize RDC. Missing libraries or init
// failures never return a hard error — an UnavailableClient is returned instead.
func NewClient(libPath string, logger *slog.Logger) (Client, error) {
	if logger == nil {
		logger = slog.Default()
	}
	return newPlatformClient(libPath, logger)
}
