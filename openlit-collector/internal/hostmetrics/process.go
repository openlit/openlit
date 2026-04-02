package hostmetrics

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"runtime"

	"github.com/shirou/gopsutil/v4/process"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

// ProcessCollector reports metrics about the collector process itself,
// following the OpenTelemetry semantic conventions for process metrics.
// https://opentelemetry.io/docs/specs/semconv/system/process-metrics/
type ProcessCollector struct {
	logger *slog.Logger
	proc   *process.Process
	reg    []metric.Registration
}

// NewProcessCollector creates process-level metric instruments for the current process.
func NewProcessCollector(provider *sdkmetric.MeterProvider, logger *slog.Logger) (*ProcessCollector, error) {
	pid := int32(os.Getpid())
	proc, err := process.NewProcess(pid)
	if err != nil {
		return nil, fmt.Errorf("accessing process %d: %w", pid, err)
	}

	pc := &ProcessCollector{
		logger: logger,
		proc:   proc,
	}

	meter := provider.Meter("openlit.process",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	// spec: process.cpu.time (Counter), attribute: cpu.mode
	cpuTime, err := meter.Float64ObservableCounter("process.cpu.time",
		metric.WithDescription("Process CPU time"),
		metric.WithUnit("s"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.cpu.time: %w", err)
	}

	// spec: process.cpu.utilization (Gauge), attribute: cpu.mode
	cpuUtil, err := meter.Float64ObservableGauge("process.cpu.utilization",
		metric.WithDescription("Process CPU utilization"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.cpu.utilization: %w", err)
	}

	// spec: process.memory.usage (UpDownCounter)
	memUsage, err := meter.Int64ObservableUpDownCounter("process.memory.usage",
		metric.WithDescription("Process resident memory (RSS)"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.memory.usage: %w", err)
	}

	// spec: process.memory.virtual (UpDownCounter)
	memVirtual, err := meter.Int64ObservableUpDownCounter("process.memory.virtual",
		metric.WithDescription("Process virtual memory size"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.memory.virtual: %w", err)
	}

	// spec: process.thread.count (UpDownCounter)
	threadCount, err := meter.Int64ObservableUpDownCounter("process.thread.count",
		metric.WithDescription("Process thread count"),
		metric.WithUnit("{thread}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.thread.count: %w", err)
	}

	// spec: process.unix.file_descriptor.count (UpDownCounter), unit: {file_descriptor}
	fdCount, err := meter.Int64ObservableUpDownCounter("process.unix.file_descriptor.count",
		metric.WithDescription("Open file descriptor count"),
		metric.WithUnit("{file_descriptor}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.unix.file_descriptor.count: %w", err)
	}

	// Custom Go runtime metrics (no spec equivalent)
	goRoutines, err := meter.Int64ObservableGauge("process.runtime.go.goroutines",
		metric.WithDescription("Number of Go goroutines"),
		metric.WithUnit("{goroutine}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.runtime.go.goroutines: %w", err)
	}

	goMemAlloc, err := meter.Int64ObservableGauge("process.runtime.go.mem.heap_alloc",
		metric.WithDescription("Go heap memory allocated"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating process.runtime.go.mem.heap_alloc: %w", err)
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			pc.collectCPU(ctx, o, cpuTime, cpuUtil)
			pc.collectMemory(ctx, o, memUsage, memVirtual)
			pc.collectThreads(ctx, o, threadCount)
			pc.collectFDs(ctx, o, fdCount)
			pc.collectGoRuntime(ctx, o, goRoutines, goMemAlloc)
			return nil
		},
		cpuTime, cpuUtil,
		memUsage, memVirtual,
		threadCount, fdCount,
		goRoutines, goMemAlloc,
	)
	if err != nil {
		return nil, fmt.Errorf("registering process callback: %w", err)
	}

	pc.reg = append(pc.reg, reg)
	logger.Info("process metrics collector initialized", "pid", pid)
	return pc, nil
}

func (pc *ProcessCollector) Close() {
	for _, r := range pc.reg {
		_ = r.Unregister()
	}
}

func (pc *ProcessCollector) collectCPU(_ context.Context, o metric.Observer,
	cpuTime metric.Float64ObservableCounter,
	cpuUtil metric.Float64ObservableGauge,
) {
	times, err := pc.proc.Times()
	if err == nil {
		// spec: cpu.mode attribute values: user, system
		o.ObserveFloat64(cpuTime, times.User,
			metric.WithAttributes(attribute.String("cpu.mode", "user")),
		)
		o.ObserveFloat64(cpuTime, times.System,
			metric.WithAttributes(attribute.String("cpu.mode", "system")),
		)
	}

	pct, err := pc.proc.Percent(0)
	if err == nil {
		o.ObserveFloat64(cpuUtil, pct/100.0)
	}
}

func (pc *ProcessCollector) collectMemory(_ context.Context, o metric.Observer,
	usage metric.Int64ObservableUpDownCounter,
	virtual metric.Int64ObservableUpDownCounter,
) {
	memInfo, err := pc.proc.MemoryInfo()
	if err != nil {
		return
	}

	o.ObserveInt64(usage, int64(memInfo.RSS))
	o.ObserveInt64(virtual, int64(memInfo.VMS))
}

func (pc *ProcessCollector) collectThreads(_ context.Context, o metric.Observer,
	threadCount metric.Int64ObservableUpDownCounter,
) {
	threads, err := pc.proc.NumThreads()
	if err == nil {
		o.ObserveInt64(threadCount, int64(threads))
	}
}

func (pc *ProcessCollector) collectFDs(_ context.Context, o metric.Observer,
	fdCount metric.Int64ObservableUpDownCounter,
) {
	if runtime.GOOS == "windows" {
		return
	}
	fds, err := pc.proc.NumFDs()
	if err == nil {
		o.ObserveInt64(fdCount, int64(fds))
	}
}

func (pc *ProcessCollector) collectGoRuntime(_ context.Context, o metric.Observer,
	goRoutines metric.Int64ObservableGauge,
	heapAlloc metric.Int64ObservableGauge,
) {
	o.ObserveInt64(goRoutines, int64(runtime.NumGoroutine()))

	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	o.ObserveInt64(heapAlloc, int64(m.HeapAlloc))
}
