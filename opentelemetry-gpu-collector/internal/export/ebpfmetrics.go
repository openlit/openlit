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
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/procname"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/workload"
)

// EBPFMetrics records eBPF CUDA tracing events as OTel metrics.
type EBPFMetrics struct {
	logger *slog.Logger

	kernelLaunchCalls  metric.Int64Counter
	kernelGridSize     metric.Float64Histogram
	kernelBlockSize    metric.Float64Histogram
	kernelSharedMemory metric.Float64Histogram
	memoryAllocations  metric.Int64Counter
	memoryCopies       metric.Float64Histogram

	devices *cudaDeviceTracker
}

// NewEBPFMetrics creates OTel instruments for eBPF CUDA event metrics.
// devices is used to map cudaSetDevice indices → hw.id / gpu.index when known.
func NewEBPFMetrics(provider *sdkmetric.MeterProvider, devices []gpu.Device, logger *slog.Logger) (*EBPFMetrics, error) {
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
		memoryAllocations:  memAlloc,
		memoryCopies:       memCopies,
		devices:            newCUDADeviceTracker(devices),
	}, nil
}

// cudaDeviceTracker maps cudaSetDevice(index) onto NVML device identity so
// activity metrics can carry hw.id / gpu.index for device-scoped dashboards.
type cudaDeviceTracker struct {
	mu sync.Mutex

	indexUUID map[int]string
	indexName map[int]string
	threadDev map[uint64]int // pid<<32|tid → CUDA device index
	soleIndex int            // set when exactly one NVIDIA device; else -1
}

const threadDevMaxSize = 8192

func newCUDADeviceTracker(devices []gpu.Device) *cudaDeviceTracker {
	t := &cudaDeviceTracker{
		indexUUID: make(map[int]string),
		indexName: make(map[int]string),
		threadDev: make(map[uint64]int),
		soleIndex: -1,
	}
	n := 0
	sole := -1
	for _, d := range devices {
		info := d.Info()
		if info.Vendor != gpu.VendorNVIDIA || info.UUID == "" {
			continue
		}
		t.indexUUID[info.Index] = info.UUID
		t.indexName[info.Index] = info.Name
		sole = info.Index
		n++
	}
	if n == 1 {
		t.soleIndex = sole
	}
	return t
}

func threadDeviceKey(pid, tid uint32) uint64 {
	return uint64(pid)<<32 | uint64(tid)
}

func (t *cudaDeviceTracker) noteSetDevice(pid, tid uint32, deviceIdx int) {
	if t == nil || deviceIdx < 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, ok := t.indexUUID[deviceIdx]; !ok {
		return
	}
	if len(t.threadDev) >= threadDevMaxSize {
		// Bound memory on long-lived nodes with high thread churn.
		n := 0
		for k := range t.threadDev {
			delete(t.threadDev, k)
			n++
			if n >= threadDevMaxSize/2 {
				break
			}
		}
	}
	t.threadDev[threadDeviceKey(pid, tid)] = deviceIdx
}

// deviceAttrs returns hw.id / gpu.index / hw.name when the thread (or sole GPU) is known.
func (t *cudaDeviceTracker) deviceAttrs(pid, tid uint32) []attribute.KeyValue {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()

	idx, ok := t.threadDev[threadDeviceKey(pid, tid)]
	if !ok {
		if t.soleIndex < 0 {
			return nil
		}
		idx = t.soleIndex
	}
	uuid := t.indexUUID[idx]
	if uuid == "" {
		return nil
	}
	attrs := []attribute.KeyValue{
		attribute.String("hw.id", uuid),
		attribute.Int("gpu.index", idx),
	}
	if name := t.indexName[idx]; name != "" {
		attrs = append(attrs, attribute.String("hw.name", name))
	}
	return attrs
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

func (em *EBPFMetrics) activityAttrs(pid, tid uint32, extra ...attribute.KeyValue) metric.MeasurementOption {
	base := cachedPIDAttrs(pid)
	var dev []attribute.KeyValue
	if em.devices != nil {
		dev = em.devices.deviceAttrs(pid, tid)
	}
	attrs := make([]attribute.KeyValue, 0, len(base)+len(dev)+len(extra))
	attrs = append(attrs, base...)
	attrs = append(attrs, dev...)
	attrs = append(attrs, extra...)
	return metric.WithAttributes(attrs...)
}

// HandleEvent processes a single CUDA event and records it as OTel metrics.
func (em *EBPFMetrics) HandleEvent(ev gpuebpf.CUDAEvent) {
	ctx := context.Background()

	switch e := ev.(type) {
	case *gpuebpf.SetDeviceEvent:
		if em.devices != nil {
			em.devices.noteSetDevice(e.PID, e.TID, int(e.Device))
		}

	case *gpuebpf.KernelLaunchEvent:
		kernelName := e.KernelName
		if kernelName == "" {
			kernelName = fmt.Sprintf("0x%x", e.KernelAddr)
		}
		attrs := em.activityAttrs(e.PID, e.TID, attribute.String("cuda.kernel.name", kernelName))

		em.kernelLaunchCalls.Add(ctx, 1, attrs)

		gridTotal := float64(e.GridX) * float64(e.GridY) * float64(e.GridZ)
		em.kernelGridSize.Record(ctx, gridTotal, attrs)

		blockTotal := float64(e.BlockX) * float64(e.BlockY) * float64(e.BlockZ)
		em.kernelBlockSize.Record(ctx, blockTotal, attrs)

		em.kernelSharedMemory.Record(ctx, float64(e.SharedMemBytes), attrs)

	case *gpuebpf.MallocEvent:
		em.memoryAllocations.Add(ctx, int64(e.Size), em.activityAttrs(e.PID, e.TID))

	case *gpuebpf.MemcpyEvent:
		em.memoryCopies.Record(ctx, float64(e.Size), em.activityAttrs(e.PID, e.TID,
			attribute.String("cuda.memcpy.kind", gpuebpf.MemcpyKindString(e.Kind)),
		))
	}
}
