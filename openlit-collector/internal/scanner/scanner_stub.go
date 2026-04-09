//go:build !linux

package scanner

import (
	"context"
	"fmt"

	"go.uber.org/zap"
)

// Scanner is a stub for non-Linux builds.
type Scanner struct {
	eventsCh chan LLMConnectEvent
}

// New returns an error on non-Linux platforms since eBPF is not supported.
func New(_ *zap.Logger, _ string) (*Scanner, error) {
	return nil, fmt.Errorf("eBPF scanner only supported on Linux")
}

// Run is a no-op on non-Linux.
func (s *Scanner) Run(_ context.Context) {}

// Events returns a nil channel on non-Linux.
func (s *Scanner) Events() <-chan LLMConnectEvent { return nil }

// Close is a no-op on non-Linux.
func (s *Scanner) Close() error { return nil }
