package export

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strconv"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	gpuebpf "github.com/openlit/openlit/opentelemetry-gpu-collector/internal/ebpf"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/procname"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/workload"
)

// EBPFMetrics records eBPF CUDA tracing events as OTel metrics.
type EBPFMetrics struct {
	logger *slog.Logger

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
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.memory.allocations: %w", err)
	}

	memCopies, err := meter.Float64Histogram("gpu.memory.copies",
		metric.WithDescription("Bytes copied per cudaMemcpy operation"),
		metric.WithUnit("By"),
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

func pidAttrs(pid uint32, extra ...attribute.KeyValue) metric.MeasurementOption {
	base := cachedPIDAttrs(pid)
	if len(extra) == 0 {
		return metric.WithAttributes(base...)
	}
	attrs := make([]attribute.KeyValue, 0, len(base)+len(extra))
	attrs = append(attrs, base...)
	attrs = append(attrs, extra...)
	return metric.WithAttributes(attrs...)
}

type pidAttrCacheEntry struct {
	attrs   []attribute.KeyValue
	expires time.Time
}

var (
	pidAttrMu    sync.Mutex
	pidAttrCache = make(map[uint32]pidAttrCacheEntry)
)

const (
	pidAttrTTL     = 5 * time.Second
	pidAttrMaxSize = 4096
)

func cachedPIDAttrs(pid uint32) []attribute.KeyValue {
	now := time.Now()
	pidAttrMu.Lock()
	if e, ok := pidAttrCache[pid]; ok && now.Before(e.expires) {
		attrs := e.attrs
		pidAttrMu.Unlock()
		return attrs
	}
	pidAttrMu.Unlock()

	attrs := []attribute.KeyValue{
		attribute.String("process.pid", strconv.FormatUint(uint64(pid), 10)),
	}
	if pid <= math.MaxInt32 {
		pid32 := int32(pid)
		attrs = append(attrs, attribute.String("process.executable.name", procname.ExecutableName(pid32)))
		if pod, ok := workload.ResolvePod(pid32); ok {
			if pod.PodUID != "" {
				attrs = append(attrs, attribute.String("k8s.pod.uid", pod.PodUID))
			}
			if pod.PodName != "" {
				attrs = append(attrs, attribute.String("k8s.pod.name", pod.PodName))
			}
			if pod.Namespace != "" {
				attrs = append(attrs, attribute.String("k8s.namespace.name", pod.Namespace))
			}
		}
	}

	pidAttrMu.Lock()
	if len(pidAttrCache) >= pidAttrMaxSize {
		// Drop expired entries; if still full, clear half.
		for k, e := range pidAttrCache {
			if now.After(e.expires) {
				delete(pidAttrCache, k)
			}
		}
		if len(pidAttrCache) >= pidAttrMaxSize {
			n := 0
			for k := range pidAttrCache {
				delete(pidAttrCache, k)
				n++
				if n >= pidAttrMaxSize/2 {
					break
				}
			}
		}
	}
	pidAttrCache[pid] = pidAttrCacheEntry{attrs: attrs, expires: now.Add(pidAttrTTL)}
	pidAttrMu.Unlock()
	return attrs
}

// HandleEvent processes a single CUDA event and records it as OTel metrics.
func (em *EBPFMetrics) HandleEvent(ev gpuebpf.CUDAEvent) {
	ctx := context.Background()

	switch e := ev.(type) {
	case *gpuebpf.KernelLaunchEvent:
		kernelName := e.KernelName
		if kernelName == "" {
			kernelName = fmt.Sprintf("0x%x", e.KernelAddr)
		}
		attrs := pidAttrs(e.PID, attribute.String("cuda.kernel.name", kernelName))

		em.kernelLaunchCalls.Add(ctx, 1, attrs)

		gridTotal := float64(e.GridX) * float64(e.GridY) * float64(e.GridZ)
		em.kernelGridSize.Record(ctx, gridTotal, attrs)

		blockTotal := float64(e.BlockX) * float64(e.BlockY) * float64(e.BlockZ)
		em.kernelBlockSize.Record(ctx, blockTotal, attrs)

	case *gpuebpf.MallocEvent:
		em.memoryAllocations.Add(ctx, int64(e.Size), pidAttrs(e.PID))

	case *gpuebpf.MemcpyEvent:
		em.memoryCopies.Record(ctx, float64(e.Size), pidAttrs(e.PID,
			attribute.String("cuda.memcpy.kind", gpuebpf.MemcpyKindString(e.Kind)),
		))
	}
}
