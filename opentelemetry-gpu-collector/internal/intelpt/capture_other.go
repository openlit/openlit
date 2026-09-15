//go:build !linux

package intelpt

import "log/slog"

type stubCapturer struct{}

func NewCapturer(logger *slog.Logger) Capturer {
	_ = logger
	return stubCapturer{}
}

func (stubCapturer) Available() bool { return false }

func (stubCapturer) Capture(Options) (Result, error) {
	return Result{}, ErrUnavailable
}
