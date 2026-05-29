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
// https://opentelemetry.io/docs/specs/semconv/system/system-metrics/
type SystemCollector struct {
	logger *slog.Logger
	reg    []metric.Registration
}

// NewSystemCollector creates system-level metric instruments and registers callbacks.
func NewSystemCollector(provider *sdkmetric.MeterProvider, logger *slog.Logger) (*SystemCollector, error) {
	sc := &SystemCollector{logger: logger}

	meter := provider.Meter("otelcol.system",
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

	// spec: system.cpu.logical.count (UpDownCounter)
	cpuCount, err := meter.Int64ObservableUpDownCounter("system.cpu.logical.count",
		metric.WithDescription("Number of CPU logical cores"),
		metric.WithUnit("{cpu}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.cpu.logical.count: %w", err)
	}

	// --- Memory ---
	// spec: system.memory.usage (UpDownCounter), attribute: system.memory.state
	memUsage, err := meter.Int64ObservableUpDownCounter("system.memory.usage",
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
	// spec: system.disk.io, attributes: system.device + disk.io.direction
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

	// spec: system.filesystem.usage, attributes: system.device + system.filesystem.*
	fsUsage, err := meter.Int64ObservableUpDownCounter("system.filesystem.usage",
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
	// spec: system.network.io, attributes: network.interface.name + network.io.direction
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
	count metric.Int64ObservableUpDownCounter,
) {
	logicalCores, err := cpu.Counts(true)
	if err == nil {
		o.ObserveInt64(count, int64(logicalCores))
	}

	percents, err := cpu.Percent(0, true)
	if err != nil {
		sc.logger.Debug("cpu percent error", "error", err)
		return
	}

	// spec: cpu.logical_number attribute for per-core, cpu.mode for mode
	for i, pct := range percents {
		attrs := metric.WithAttributes(attribute.Int("cpu.logical_number", i))
		o.ObserveFloat64(utilization, pct/100.0, attrs)
	}

	// Aggregate across all cores
	aggPercents, err := cpu.Percent(0, false)
	if err == nil && len(aggPercents) > 0 {
		o.ObserveFloat64(utilization, aggPercents[0]/100.0)
	}
}

func (sc *SystemCollector) collectMemory(_ context.Context, o metric.Observer,
	usage metric.Int64ObservableUpDownCounter,
	utilization metric.Float64ObservableGauge,
) {
	v, err := mem.VirtualMemory()
	if err != nil {
		sc.logger.Debug("memory error", "error", err)
		return
	}

	// spec: system.memory.state attribute values: used, free, cached, buffers
	o.ObserveInt64(usage, int64(v.Used),
		metric.WithAttributes(attribute.String("system.memory.state", "used")),
	)
	o.ObserveInt64(usage, int64(v.Free),
		metric.WithAttributes(attribute.String("system.memory.state", "free")),
	)

	if runtime.GOOS == "linux" {
		o.ObserveInt64(usage, int64(v.Cached),
			metric.WithAttributes(attribute.String("system.memory.state", "cached")),
		)
		o.ObserveInt64(usage, int64(v.Buffers),
			metric.WithAttributes(attribute.String("system.memory.state", "buffers")),
		)
	}

	o.ObserveFloat64(utilization, v.UsedPercent/100.0)
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
		// spec: system.device + disk.io.direction
		readAttrs := metric.WithAttributes(
			attribute.String("system.device", device),
			attribute.String("disk.io.direction", "read"),
		)
		writeAttrs := metric.WithAttributes(
			attribute.String("system.device", device),
			attribute.String("disk.io.direction", "write"),
		)

		o.ObserveInt64(ioBytes, int64(stat.ReadBytes), readAttrs)
		o.ObserveInt64(ioBytes, int64(stat.WriteBytes), writeAttrs)
		o.ObserveInt64(ops, int64(stat.ReadCount), readAttrs)
		o.ObserveInt64(ops, int64(stat.WriteCount), writeAttrs)
	}
}

func (sc *SystemCollector) collectFilesystem(_ context.Context, o metric.Observer,
	usage metric.Int64ObservableUpDownCounter,
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

		// spec: system.device, system.filesystem.mountpoint, system.filesystem.type, system.filesystem.state
		baseAttrs := []attribute.KeyValue{
			attribute.String("system.device", p.Device),
			attribute.String("system.filesystem.mountpoint", p.Mountpoint),
			attribute.String("system.filesystem.type", p.Fstype),
		}

		o.ObserveInt64(usage, int64(stat.Used),
			metric.WithAttributes(append(baseAttrs, attribute.String("system.filesystem.state", "used"))...),
		)
		o.ObserveInt64(usage, int64(stat.Free),
			metric.WithAttributes(append(baseAttrs, attribute.String("system.filesystem.state", "free"))...),
		)
		o.ObserveFloat64(utilization, stat.UsedPercent/100.0,
			metric.WithAttributes(baseAttrs...),
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

		// spec: network.interface.name + network.io.direction
		rxAttrs := metric.WithAttributes(
			attribute.String("network.interface.name", stat.Name),
			attribute.String("network.io.direction", "receive"),
		)
		txAttrs := metric.WithAttributes(
			attribute.String("network.interface.name", stat.Name),
			attribute.String("network.io.direction", "transmit"),
		)

		o.ObserveInt64(ioBytes, int64(stat.BytesRecv), rxAttrs)
		o.ObserveInt64(ioBytes, int64(stat.BytesSent), txAttrs)
		o.ObserveInt64(errors, int64(stat.Errin), rxAttrs)
		o.ObserveInt64(errors, int64(stat.Errout), txAttrs)
	}
}

// cpuTimeSinceStart primes the CPU percent calculation so the first real call returns meaningful data.
func init() {
	go func() {
		_, _ = cpu.Percent(200*time.Millisecond, false)
	}()
}
