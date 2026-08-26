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

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/cudaspans"
	gpuebpf "github.com/openlit/openlit/opentelemetry-gpu-collector/internal/ebpf"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/procname"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/workload"
)

// EBPFMetrics records eBPF CUDA tracing events as OTel metrics.
// Launch→sync duration samples come from cudaspans.ClosedSpan (shared with occupancy).
type EBPFMetrics struct {
	logger *slog.Logger

	kernelLaunchCalls  metric.Int64Counter
	kernelGridSize     metric.Float64Histogram
	kernelBlockSize    metric.Float64Histogram
	kernelSharedMemory metric.Float64Histogram
	kernelDuration     metric.Float64Histogram
	graphLaunchCalls   metric.Int64Counter
	memoryAllocations  metric.Int64Counter
	memoryCopies       metric.Float64Histogram

	devices *cudaspans.DeviceResolver

	kernelNamesMu sync.Mutex
	kernelNames   map[string]struct{} // cardinality set for cuda.kernel.name
}

const maxKernelDurationNames = 64

// NewEBPFMetrics creates OTel instruments for eBPF CUDA event metrics.
// devices maps cudaSetDevice indices → hw.id / gpu.index when known.
func NewEBPFMetrics(provider *sdkmetric.MeterProvider, devices *cudaspans.DeviceResolver, logger *slog.Logger) (*EBPFMetrics, error) {
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

	sharedMem, err := meter.Float64Histogram("gpu.kernel.shared_memory",
		metric.WithDescription("Dynamic shared memory requested per CUDA kernel launch (cudaLaunchKernel sharedMem)"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.kernel.shared_memory: %w", err)
	}

	kernelDur, err := meter.Float64Histogram("gpu.kernel.duration",
		metric.WithDescription("Model estimate of CUDA kernel launch→sync duration (not hardware SM residency)"),
		metric.WithUnit("s"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.kernel.duration: %w", err)
	}

	graphCalls, err := meter.Int64Counter("gpu.graph.launch.calls",
		metric.WithDescription("Number of CUDA graph replay invocations (cudaGraphLaunch/cuGraphLaunch). Counts replays, not the kernels executed inside each replay; that number is not observable at this API-tracing layer."),
		metric.WithUnit("{call}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating gpu.graph.launch.calls: %w", err)
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
		logger:             logger,
		kernelLaunchCalls:  kernelCalls,
		kernelGridSize:     gridSize,
		kernelBlockSize:    blockSize,
		kernelSharedMemory: sharedMem,
		kernelDuration:     kernelDur,
		graphLaunchCalls:   graphCalls,
		memoryAllocations:  memAlloc,
		memoryCopies:       memCopies,
		devices:            devices,
		kernelNames:        make(map[string]struct{}),
	}, nil
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

func (em *EBPFMetrics) deviceAttrs(pid, tid uint32) []attribute.KeyValue {
	if em.devices == nil {
		return nil
	}
	idx := em.devices.ResolveIndex(pid, tid)
	uuid, name, pci, ok := em.devices.IndexInfo(idx)
	if !ok {
		return nil
	}
	attrs := []attribute.KeyValue{
		attribute.String("hw.id", uuid),
		attribute.String("hw.type", "gpu"),
		attribute.String("hw.vendor", string(gpu.VendorNVIDIA)),
		attribute.Int("gpu.index", idx),
	}
	if name != "" {
		attrs = append(attrs,
			attribute.String("hw.name", name),
			attribute.String("hw.model", name),
		)
	}
	if pci != "" {
		attrs = append(attrs, attribute.String("gpu.pci_address", pci))
	}
	return attrs
}

func (em *EBPFMetrics) activityAttrs(pid, tid uint32, extra ...attribute.KeyValue) metric.MeasurementOption {
	base := cachedPIDAttrs(pid)
	dev := em.deviceAttrs(pid, tid)
	attrs := make([]attribute.KeyValue, 0, len(base)+len(dev)+len(extra)+1)
	attrs = append(attrs, base...)
	attrs = append(attrs, attribute.String("gpu.measurement.source", "ebpf"))
	attrs = append(attrs, dev...)
	attrs = append(attrs, extra...)
	return metric.WithAttributes(attrs...)
}

func kernelMetricName(e *gpuebpf.KernelLaunchEvent) string {
	if e.KernelName != "" {
		return e.KernelName
	}
	return "unknown"
}

func (em *EBPFMetrics) durationKernelName(raw string) string {
	if raw == "" {
		raw = "unknown"
	}
	em.kernelNamesMu.Lock()
	defer em.kernelNamesMu.Unlock()
	if _, ok := em.kernelNames[raw]; ok {
		return raw
	}
	if len(em.kernelNames) >= maxKernelDurationNames {
		return "other"
	}
	em.kernelNames[raw] = struct{}{}
	return raw
}

// RecordClosedSpans emits gpu.kernel.duration from shared launch→sync closes.
func (em *EBPFMetrics) RecordClosedSpans(ctx context.Context, spans []cudaspans.ClosedSpan) {
	if em == nil || len(spans) == 0 {
		return
	}
	for _, s := range spans {
		if s.EndNs <= s.StartNs {
			continue
		}
		durSec := float64(s.EndNs-s.StartNs) / 1e9
		name := em.durationKernelName(s.KernelName)
		extra := []attribute.KeyValue{attribute.String("cuda.kernel.name", name)}
		if s.Kind == cudaspans.LaunchKindGraph {
			extra = append(extra, attribute.String("cuda.launch.kind", "graph"))
		}
		attrs := em.activityAttrs(s.PID, s.TID, extra...)
		em.kernelDuration.Record(ctx, durSec, attrs)
	}
}

// RecordLaunchActivity records launch counters/histograms (not duration).
func (em *EBPFMetrics) RecordLaunchActivity(ctx context.Context, e *gpuebpf.KernelLaunchEvent) {
	kernelName := kernelMetricName(e)
	extra := []attribute.KeyValue{attribute.String("cuda.kernel.name", kernelName)}
	attrs := em.activityAttrs(e.PID, e.TID, extra...)

	em.kernelLaunchCalls.Add(ctx, 1, attrs)

	gridTotal := float64(e.GridX) * float64(e.GridY) * float64(e.GridZ)
	em.kernelGridSize.Record(ctx, gridTotal, attrs)

	blockTotal := float64(e.BlockX) * float64(e.BlockY) * float64(e.BlockZ)
	em.kernelBlockSize.Record(ctx, blockTotal, attrs)

	em.kernelSharedMemory.Record(ctx, float64(e.SharedMemBytes), attrs)
}

func (em *EBPFMetrics) RecordGraphLaunch(ctx context.Context, e *gpuebpf.GraphLaunchEvent) {
	em.graphLaunchCalls.Add(ctx, 1, em.activityAttrs(e.PID, e.TID))
}

// HandleEvent processes activity-only events when used without SpanFanout.
// Prefer SpanFanout so occupancy and duration share one launch→sync store.
func (em *EBPFMetrics) HandleEvent(ev gpuebpf.CUDAEvent) {
	ctx := context.Background()

	switch e := ev.(type) {
	case *gpuebpf.SetDeviceEvent:
		if em.devices != nil {
			em.devices.NoteSetDevice(e.PID, e.TID, int(e.Device))
		}

	case *gpuebpf.KernelLaunchEvent:
		em.RecordLaunchActivity(ctx, e)

	case *gpuebpf.GraphLaunchEvent:
		em.RecordGraphLaunch(ctx, e)

	case *gpuebpf.MallocEvent:
		em.memoryAllocations.Add(ctx, int64(e.Size), em.activityAttrs(e.PID, e.TID))

	case *gpuebpf.MemcpyEvent:
		em.memoryCopies.Record(ctx, float64(e.Size), em.activityAttrs(e.PID, e.TID,
			attribute.String("cuda.memcpy.kind", gpuebpf.MemcpyKindString(e.Kind)),
		))
	}
}
