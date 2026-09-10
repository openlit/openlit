package dcgm

import (
	"log/slog"
	"time"
)

// Client samples DCGM metrics and supports profiling pause/resume.
type Client interface {
	Sample() ([]Sample, error)
	PauseProfiling(duration time.Duration) error
	ResumeProfiling() error
	Close() error
	Available() bool
}

// UnavailableClient is a no-op Client used when libdcgm is missing or init fails.
type UnavailableClient struct{}

// Sample returns no samples.
func (UnavailableClient) Sample() ([]Sample, error) { return nil, nil }

// PauseProfiling is a no-op.
func (UnavailableClient) PauseProfiling(time.Duration) error { return nil }

// ResumeProfiling is a no-op.
func (UnavailableClient) ResumeProfiling() error { return nil }

// Close is a no-op.
func (UnavailableClient) Close() error { return nil }

// Available reports false.
func (UnavailableClient) Available() bool { return false }

// NewClient attempts to load and initialize DCGM. Missing libraries or init
// failures never return a hard error — an UnavailableClient is returned instead.
func NewClient(libPath, address string, fieldsCSV string, interval time.Duration, logger *slog.Logger) (Client, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if interval <= 0 {
		interval = 10 * time.Second
	}
	fields := ParseFieldsCSV(fieldsCSV)
	return newPlatformClient(libPath, address, fields, interval, logger)
}
