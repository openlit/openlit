package export

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	gpuebpf "github.com/openlit/openlit/openlit-collector/internal/ebpf"
)

// EBPFMetrics records eBPF CUDA tracing events as OTel metrics.
type EBPFMetrics struct {
	logger *slog.Logger
	mu     sync.Mutex

	kernelLaunchCalls metric.Int64Counter
	kernelGridSize    metric.Float64Histogram
	kernelBlockSize   metric.Float64Histogram
	memoryAllocations metric.Int64Counter
	memoryCopies      metric.Float64Histogram
}

// NewEBPFMetrics creates OTel instruments for eBPF CUDA event metrics.
func NewEBPFMetrics(provider *sdkmetric.MeterProvider, logger *slog.Logger) (*EBPFMetrics, error) {
	meter := provider.Meter("otelcol.gpu.ebpf",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	kernelCalls, err := meter.Int64Counter("gpu.kernel.launch.calls",
		metric.WithDescription("Number of CUDA kernel launches"),
		metric.WithUnit("{call}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.kernel.launch.calls: %w", err)
	}

	gridSize, err := meter.Float64Histogram("gpu.kernel.grid.size",
		metric.WithDescription("Total threads in CUDA grid per kernel launch"),
		metric.WithUnit("{thread}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.kernel.grid.size: %w", err)
	}

	blockSize, err := meter.Float64Histogram("gpu.kernel.block.size",
		metric.WithDescription("Threads per CUDA block per kernel launch"),
		metric.WithUnit("{thread}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.kernel.block.size: %w", err)
	}

	memAlloc, err := meter.Int64Counter("gpu.memory.allocations",
		metric.WithDescription("Total bytes allocated via cudaMalloc"),
		metric.WithUnit("bytes"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.memory.allocations: %w", err)
	}

	memCopies, err := meter.Float64Histogram("gpu.memory.copies",
		metric.WithDescription("Bytes copied per cudaMemcpy operation"),
		metric.WithUnit("bytes"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.memory.copies: %w", err)
	}

	return &EBPFMetrics{
		logger:            logger,
		kernelLaunchCalls: kernelCalls,
		kernelGridSize:    gridSize,
		kernelBlockSize:   blockSize,
		memoryAllocations: memAlloc,
		memoryCopies:      memCopies,
	}, nil
}

// HandleEvent processes a single CUDA event and records it as OTel metrics.
// This is the EventHandler passed to the eBPF Tracer.
func (em *EBPFMetrics) HandleEvent(ev gpuebpf.CUDAEvent) {
	ctx := context.Background()

	switch e := ev.(type) {
	case *gpuebpf.KernelLaunchEvent:
		kernelName := e.KernelName
		if kernelName == "" {
			kernelName = fmt.Sprintf("0x%x", e.KernelAddr)
		}
		attrs := metric.WithAttributes(attribute.String("cuda.kernel.name", kernelName))

		em.kernelLaunchCalls.Add(ctx, 1, attrs)

		gridTotal := float64(e.GridX) * float64(e.GridY) * float64(e.GridZ)
		em.kernelGridSize.Record(ctx, gridTotal, attrs)

		blockTotal := float64(e.BlockX) * float64(e.BlockY) * float64(e.BlockZ)
		em.kernelBlockSize.Record(ctx, blockTotal, attrs)

	case *gpuebpf.MallocEvent:
		em.memoryAllocations.Add(ctx, int64(e.Size))

	case *gpuebpf.MemcpyEvent:
		attrs := metric.WithAttributes(
			attribute.String("cuda.memcpy.kind", gpuebpf.MemcpyKindString(e.Kind)),
		)
		em.memoryCopies.Record(ctx, float64(e.Size), attrs)
	}
}
