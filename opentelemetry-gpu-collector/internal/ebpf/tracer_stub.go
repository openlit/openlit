//go:build !(linux && (amd64 || arm64))

package ebpf

import (
	"context"
	"fmt"
	"log/slog"
	"runtime"
)

type Tracer struct{}

func NewTracer(_ *slog.Logger, _ EventHandler) (*Tracer, error) {
	return nil, fmt.Errorf("eBPF CUDA tracing is not supported on %s/%s (supported: linux/amd64, linux/arm64)", runtime.GOOS, runtime.GOARCH)
}

func (t *Tracer) Run(_ context.Context) {}
func (t *Tracer) Close()                {}
