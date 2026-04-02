//go:build !linux

package ebpf

import (
	"context"
	"fmt"
	"log/slog"
)

type Tracer struct{}

func NewTracer(_ *slog.Logger, _ EventHandler) (*Tracer, error) {
	return nil, fmt.Errorf("eBPF CUDA tracing is only supported on Linux")
}

func (t *Tracer) Run(_ context.Context) {}
func (t *Tracer) Close()                {}
