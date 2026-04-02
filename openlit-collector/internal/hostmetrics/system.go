package hostmetrics

import (
	"context"
	"fmt"
	"log/slog"
	"runtime"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

// SystemCollector registers OTel instruments for host-level system metrics
// following the OpenTelemetry semantic conventions for system metrics.
// Works on Linux, macOS, and Windows via gopsutil.
type SystemCollector struct {
	logger *slog.Logger
	reg    []metric.Registration
}

// NewSystemCollector creates system-level metric instruments and registers callbacks.
func NewSystemCollector(provider *sdkmetric.MeterProvider, logger *slog.Logger) (*SystemCollector, error) {
	sc := &SystemCollector{logger: logger}

	meter := provider.Meter("openlit.system",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	// --- CPU ---
	cpuUtilization, err := meter.Float64ObservableGauge("system.cpu.utilization",
		metric.WithDescription("CPU utilization (0.0-1.0)"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.cpu.utilization: %w", err)
	}

	cpuCount, err := meter.Int64ObservableGauge("system.cpu.count",
		metric.WithDescription("Number of CPU logical cores"),
		metric.WithUnit("{cpu}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.cpu.count: %w", err)
	}

	// --- Memory ---
	memUsage, err := meter.Int64ObservableGauge("system.memory.usage",
		metric.WithDescription("Memory usage by state"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.memory.usage: %w", err)
	}

	memUtilization, err := meter.Float64ObservableGauge("system.memory.utilization",
		metric.WithDescription("Memory utilization (0.0-1.0)"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.memory.utilization: %w", err)
	}

	// --- Disk ---
	diskIO, err := meter.Int64ObservableCounter("system.disk.io",
		metric.WithDescription("Disk I/O bytes"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.disk.io: %w", err)
	}

	diskOps, err := meter.Int64ObservableCounter("system.disk.operations",
		metric.WithDescription("Disk I/O operations"),
		metric.WithUnit("{operation}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.disk.operations: %w", err)
	}

	fsUsage, err := meter.Int64ObservableGauge("system.filesystem.usage",
		metric.WithDescription("Filesystem space usage"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.filesystem.usage: %w", err)
	}

	fsUtilization, err := meter.Float64ObservableGauge("system.filesystem.utilization",
		metric.WithDescription("Filesystem utilization (0.0-1.0)"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.filesystem.utilization: %w", err)
	}

	// --- Network ---
	netIO, err := meter.Int64ObservableCounter("system.network.io",
		metric.WithDescription("Network I/O bytes"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.network.io: %w", err)
	}

	netErrors, err := meter.Int64ObservableCounter("system.network.errors",
		metric.WithDescription("Network error count"),
		metric.WithUnit("{error}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.network.errors: %w", err)
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			sc.collectCPU(ctx, o, cpuUtilization, cpuCount)
			sc.collectMemory(ctx, o, memUsage, memUtilization)
			sc.collectDisk(ctx, o, diskIO, diskOps)
			sc.collectFilesystem(ctx, o, fsUsage, fsUtilization)
			sc.collectNetwork(ctx, o, netIO, netErrors)
			return nil
		},
		cpuUtilization, cpuCount,
		memUsage, memUtilization,
		diskIO, diskOps,
		fsUsage, fsUtilization,
		netIO, netErrors,
	)
	if err != nil {
		return nil, fmt.Errorf("registering system callback: %w", err)
	}

	sc.reg = append(sc.reg, reg)
	logger.Info("system metrics collector initialized", "os", runtime.GOOS, "arch", runtime.GOARCH)
	return sc, nil
}

func (sc *SystemCollector) Close() {
	for _, r := range sc.reg {
		_ = r.Unregister()
	}
}

func (sc *SystemCollector) collectCPU(_ context.Context, o metric.Observer,
	utilization metric.Float64ObservableGauge,
	count metric.Int64ObservableGauge,
) {
	logicalCores, err := cpu.Counts(true)
	if err == nil {
		o.ObserveInt64(count, int64(logicalCores))
	}

	// Per-CPU utilization over a very short window.
	// Use Percent with 0 interval to get instant snapshot vs previous call.
	percents, err := cpu.Percent(0, true)
	if err != nil {
		sc.logger.Debug("cpu percent error", "error", err)
		return
	}

	for i, pct := range percents {
		attrs := metric.WithAttributes(attribute.Int("cpu", i))
		o.ObserveFloat64(utilization, pct/100.0, attrs)
	}

	// Also report aggregate
	aggPercents, err := cpu.Percent(0, false)
	if err == nil && len(aggPercents) > 0 {
		o.ObserveFloat64(utilization, aggPercents[0]/100.0,
			metric.WithAttributes(attribute.String("cpu", "total")),
		)
	}
}

func (sc *SystemCollector) collectMemory(_ context.Context, o metric.Observer,
	usage metric.Int64ObservableGauge,
	utilization metric.Float64ObservableGauge,
) {
	v, err := mem.VirtualMemory()
	if err != nil {
		sc.logger.Debug("memory error", "error", err)
		return
	}

	o.ObserveInt64(usage, int64(v.Used),
		metric.WithAttributes(attribute.String("state", "used")),
	)
	o.ObserveInt64(usage, int64(v.Available),
		metric.WithAttributes(attribute.String("state", "available")),
	)
	o.ObserveInt64(usage, int64(v.Free),
		metric.WithAttributes(attribute.String("state", "free")),
	)

	if runtime.GOOS == "linux" {
		o.ObserveInt64(usage, int64(v.Cached),
			metric.WithAttributes(attribute.String("state", "cached")),
		)
		o.ObserveInt64(usage, int64(v.Buffers),
			metric.WithAttributes(attribute.String("state", "buffers")),
		)
	}

	o.ObserveFloat64(utilization, v.UsedPercent/100.0)

	// Swap
	s, err := mem.SwapMemory()
	if err == nil {
		o.ObserveInt64(usage, int64(s.Used),
			metric.WithAttributes(attribute.String("state", "swap_used")),
		)
		o.ObserveInt64(usage, int64(s.Free),
			metric.WithAttributes(attribute.String("state", "swap_free")),
		)
	}
}

func (sc *SystemCollector) collectDisk(_ context.Context, o metric.Observer,
	ioBytes metric.Int64ObservableCounter,
	ops metric.Int64ObservableCounter,
) {
	counters, err := disk.IOCounters()
	if err != nil {
		sc.logger.Debug("disk io error", "error", err)
		return
	}

	for device, stat := range counters {
		readAttrs := metric.WithAttributes(
			attribute.String("device", device),
			attribute.String("direction", "read"),
		)
		writeAttrs := metric.WithAttributes(
			attribute.String("device", device),
			attribute.String("direction", "write"),
		)

		o.ObserveInt64(ioBytes, int64(stat.ReadBytes), readAttrs)
		o.ObserveInt64(ioBytes, int64(stat.WriteBytes), writeAttrs)
		o.ObserveInt64(ops, int64(stat.ReadCount), readAttrs)
		o.ObserveInt64(ops, int64(stat.WriteCount), writeAttrs)
	}
}

func (sc *SystemCollector) collectFilesystem(_ context.Context, o metric.Observer,
	usage metric.Int64ObservableGauge,
	utilization metric.Float64ObservableGauge,
) {
	partitions, err := disk.Partitions(false)
	if err != nil {
		sc.logger.Debug("filesystem partitions error", "error", err)
		return
	}

	for _, p := range partitions {
		stat, err := disk.Usage(p.Mountpoint)
		if err != nil {
			continue
		}

		attrs := []attribute.KeyValue{
			attribute.String("device", p.Device),
			attribute.String("mountpoint", p.Mountpoint),
			attribute.String("type", p.Fstype),
		}

		o.ObserveInt64(usage, int64(stat.Used),
			metric.WithAttributes(append(attrs, attribute.String("state", "used"))...),
		)
		o.ObserveInt64(usage, int64(stat.Free),
			metric.WithAttributes(append(attrs, attribute.String("state", "free"))...),
		)
		o.ObserveFloat64(utilization, stat.UsedPercent/100.0,
			metric.WithAttributes(attrs...),
		)
	}
}

func (sc *SystemCollector) collectNetwork(_ context.Context, o metric.Observer,
	ioBytes metric.Int64ObservableCounter,
	errors metric.Int64ObservableCounter,
) {
	counters, err := net.IOCounters(true)
	if err != nil {
		sc.logger.Debug("network io error", "error", err)
		return
	}

	for _, stat := range counters {
		if stat.Name == "lo" || stat.Name == "lo0" {
			continue
		}

		rxAttrs := metric.WithAttributes(
			attribute.String("device", stat.Name),
			attribute.String("direction", "receive"),
		)
		txAttrs := metric.WithAttributes(
			attribute.String("device", stat.Name),
			attribute.String("direction", "transmit"),
		)

		o.ObserveInt64(ioBytes, int64(stat.BytesRecv), rxAttrs)
		o.ObserveInt64(ioBytes, int64(stat.BytesSent), txAttrs)
		o.ObserveInt64(errors, int64(stat.Errin), rxAttrs)
		o.ObserveInt64(errors, int64(stat.Errout), txAttrs)
	}
}

// cpuTimeSinceStart is used to initialize the first cpu.Percent call.
func init() {
	// Prime the CPU percent calculation so the first real call returns meaningful data.
	// cpu.Percent with interval > 0 blocks, so we use a very short interval.
	go func() {
		_, _ = cpu.Percent(200*time.Millisecond, false)
	}()
}
