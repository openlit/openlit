package hostmetrics

import (
	"context"
	"fmt"
	"log/slog"
	"runtime"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
)

// SystemCollector registers OTel instruments for host-level system metrics
// following the OpenTelemetry semantic conventions for system metrics.
// https://opentelemetry.io/docs/specs/semconv/system/system-metrics/
type SystemCollector struct {
	logger      *slog.Logger
	fsExclude   map[string]bool // filesystem types excluded from system.filesystem.*
	netAllow    map[string]bool // empty = all non-excluded
	netExclude  map[string]bool
	skipNetwork bool // when NIC collector owns per-iface hw.network.*
	reg         []metric.Registration
}

// NewSystemCollector creates system-level metric instruments and registers callbacks.
// When cfg is nil, filesystem filtering is disabled and loopback interfaces are excluded.
func NewSystemCollector(provider *sdkmetric.MeterProvider, logger *slog.Logger, cfg *config.Config) (*SystemCollector, error) {
	if cfg == nil {
		cfg = &config.Config{
			NetInterfaceExclude: []string{"lo", "lo0"},
		}
	}

	sc := &SystemCollector{logger: logger, skipNetwork: cfg.NICEnabled}
	if len(cfg.FSTypesExclude) > 0 {
		sc.fsExclude = make(map[string]bool, len(cfg.FSTypesExclude))
		for _, t := range cfg.FSTypesExclude {
			sc.fsExclude[t] = true
		}
	}
	if len(cfg.NetInterfaces) > 0 {
		sc.netAllow = make(map[string]bool, len(cfg.NetInterfaces))
		for _, n := range cfg.NetInterfaces {
			sc.netAllow[n] = true
		}
	}
	if len(cfg.NetInterfaceExclude) > 0 {
		sc.netExclude = make(map[string]bool, len(cfg.NetInterfaceExclude))
		for _, n := range cfg.NetInterfaceExclude {
			sc.netExclude[n] = true
		}
	}

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

	cpuTime, err := meter.Float64ObservableCounter("system.cpu.time",
		metric.WithDescription("Seconds each logical CPU spent in each mode"),
		metric.WithUnit("s"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.cpu.time: %w", err)
	}

	cpuFrequency, err := meter.Float64ObservableGauge("system.cpu.frequency",
		metric.WithDescription("Current CPU frequency"),
		metric.WithUnit("Hz"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.cpu.frequency: %w", err)
	}

	cpuLogicalCount, err := meter.Int64ObservableUpDownCounter("system.cpu.logical.count",
		metric.WithDescription("Number of CPU logical cores"),
		metric.WithUnit("{cpu}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.cpu.logical.count: %w", err)
	}

	cpuPhysicalCount, err := meter.Int64ObservableUpDownCounter("system.cpu.physical.count",
		metric.WithDescription("Number of CPU physical cores"),
		metric.WithUnit("{cpu}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.cpu.physical.count: %w", err)
	}

	uptime, err := meter.Float64ObservableGauge("system.uptime",
		metric.WithDescription("System uptime"),
		metric.WithUnit("s"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.uptime: %w", err)
	}

	// --- Memory ---
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

	// --- Paging / swap ---
	pagingUsage, err := meter.Int64ObservableUpDownCounter("system.paging.usage",
		metric.WithDescription("Swap/paging usage by state"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.paging.usage: %w", err)
	}

	pagingUtilization, err := meter.Float64ObservableGauge("system.paging.utilization",
		metric.WithDescription("Swap/paging utilization (0.0-1.0)"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.paging.utilization: %w", err)
	}

	pagingFaults, err := meter.Int64ObservableCounter("system.paging.faults",
		metric.WithDescription("Number of page faults"),
		metric.WithUnit("{fault}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.paging.faults: %w", err)
	}

	pagingOps, err := meter.Int64ObservableCounter("system.paging.operations",
		metric.WithDescription("Number of paging operations"),
		metric.WithUnit("{operation}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.paging.operations: %w", err)
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
	// Skip system.network.* when the NIC collector is enabled to avoid double-counting
	// the same iface bytes/packets (use hw.network.* + network.interface.name instead).
	var (
		netIO      metric.Int64ObservableCounter
		netErrors  metric.Int64ObservableCounter
		netPackets metric.Int64ObservableCounter
		netDropped metric.Int64ObservableCounter
	)
	if !sc.skipNetwork {
		netIO, err = meter.Int64ObservableCounter("system.network.io",
			metric.WithDescription("Network I/O bytes"),
			metric.WithUnit("By"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating system.network.io: %w", err)
		}

		netErrors, err = meter.Int64ObservableCounter("system.network.errors",
			metric.WithDescription("Network error count"),
			metric.WithUnit("{error}"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating system.network.errors: %w", err)
		}

		netPackets, err = meter.Int64ObservableCounter("system.network.packet.count",
			metric.WithDescription("Network packet count"),
			metric.WithUnit("{packet}"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating system.network.packet.count: %w", err)
		}

		netDropped, err = meter.Int64ObservableCounter("system.network.packet.dropped",
			metric.WithDescription("Network packets dropped"),
			metric.WithUnit("{packet}"),
		)
		if err != nil {
			return nil, fmt.Errorf("creating system.network.packet.dropped: %w", err)
		}
	}

	// --- Processes ---
	procCount, err := meter.Int64ObservableUpDownCounter("system.process.count",
		metric.WithDescription("Total number of processes in each state"),
		metric.WithUnit("{process}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating system.process.count: %w", err)
	}

	instruments := []metric.Observable{
		cpuUtilization, cpuTime, cpuFrequency, cpuLogicalCount, cpuPhysicalCount, uptime,
		memUsage, memUtilization,
		pagingUsage, pagingUtilization, pagingFaults, pagingOps,
		diskIO, diskOps,
		fsUsage, fsUtilization,
		procCount,
	}
	if !sc.skipNetwork {
		instruments = append(instruments, netIO, netErrors, netPackets, netDropped)
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			sc.collectCPU(ctx, o, cpuUtilization, cpuTime, cpuFrequency, cpuLogicalCount, cpuPhysicalCount)
			sc.collectUptime(ctx, o, uptime)
			sc.collectMemory(ctx, o, memUsage, memUtilization)
			sc.collectPaging(ctx, o, pagingUsage, pagingUtilization, pagingFaults, pagingOps)
			sc.collectDisk(ctx, o, diskIO, diskOps)
			sc.collectFilesystem(ctx, o, fsUsage, fsUtilization)
			if !sc.skipNetwork {
				sc.collectNetwork(ctx, o, netIO, netErrors, netPackets, netDropped)
			}
			sc.collectProcessCount(ctx, o, procCount)
			return nil
		},
		instruments...,
	)
	if err != nil {
		return nil, fmt.Errorf("registering system callback: %w", err)
	}

	sc.reg = append(sc.reg, reg)
	logger.Info("system metrics collector initialized",
		"os", runtime.GOOS,
		"arch", runtime.GOARCH,
		"skip_network", sc.skipNetwork,
	)
	return sc, nil
}

func (sc *SystemCollector) Close() {
	for _, r := range sc.reg {
		_ = r.Unregister()
	}
}

func (sc *SystemCollector) includeNetInterface(name string) bool {
	if sc.netExclude[name] {
		return false
	}
	if len(sc.netAllow) > 0 {
		return sc.netAllow[name]
	}
	return true
}

func (sc *SystemCollector) collectCPU(_ context.Context, o metric.Observer,
	utilization metric.Float64ObservableGauge,
	cpuTime metric.Float64ObservableCounter,
	frequency metric.Float64ObservableGauge,
	logicalCount metric.Int64ObservableUpDownCounter,
	physicalCount metric.Int64ObservableUpDownCounter,
) {
	if n, err := cpu.Counts(true); err == nil {
		o.ObserveInt64(logicalCount, int64(n))
	}
	if n, err := cpu.Counts(false); err == nil {
		o.ObserveInt64(physicalCount, int64(n))
	}

	if times, err := cpu.Times(true); err != nil {
		sc.logger.Debug("cpu times error", "error", err)
	} else {
		for i, t := range times {
			attrs := func(mode string) metric.MeasurementOption {
				return metric.WithAttributes(
					attribute.Int("cpu.logical_number", i),
					attribute.String("cpu.mode", mode),
				)
			}
			o.ObserveFloat64(cpuTime, t.User, attrs("user"))
			o.ObserveFloat64(cpuTime, t.System, attrs("system"))
			o.ObserveFloat64(cpuTime, t.Nice, attrs("nice"))
			o.ObserveFloat64(cpuTime, t.Idle, attrs("idle"))
			o.ObserveFloat64(cpuTime, t.Iowait, attrs("iowait"))
			o.ObserveFloat64(cpuTime, t.Irq, attrs("interrupt"))
			o.ObserveFloat64(cpuTime, t.Softirq, attrs("softirq"))
			o.ObserveFloat64(cpuTime, t.Steal, attrs("steal"))
		}
	}

	if infos, err := cpu.Info(); err == nil {
		for _, info := range infos {
			if info.Mhz <= 0 {
				continue
			}
			o.ObserveFloat64(frequency, info.Mhz*1e6,
				metric.WithAttributes(attribute.Int("cpu.logical_number", int(info.CPU))),
			)
		}
	}

	percents, err := cpu.Percent(0, true)
	if err != nil {
		sc.logger.Debug("cpu percent error", "error", err)
		return
	}
	for i, pct := range percents {
		attrs := metric.WithAttributes(attribute.Int("cpu.logical_number", i))
		o.ObserveFloat64(utilization, pct/100.0, attrs)
	}
	if aggPercents, err := cpu.Percent(0, false); err == nil && len(aggPercents) > 0 {
		o.ObserveFloat64(utilization, aggPercents[0]/100.0)
	}
}

func (sc *SystemCollector) collectUptime(_ context.Context, o metric.Observer,
	uptime metric.Float64ObservableGauge,
) {
	u, err := host.Uptime()
	if err != nil {
		sc.logger.Debug("uptime error", "error", err)
		return
	}
	o.ObserveFloat64(uptime, float64(u))
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

func (sc *SystemCollector) collectPaging(_ context.Context, o metric.Observer,
	usage metric.Int64ObservableUpDownCounter,
	utilization metric.Float64ObservableGauge,
	faults metric.Int64ObservableCounter,
	ops metric.Int64ObservableCounter,
) {
	swap, err := mem.SwapMemory()
	if err != nil {
		sc.logger.Debug("swap memory error", "error", err)
		return
	}

	o.ObserveInt64(usage, int64(swap.Used),
		metric.WithAttributes(attribute.String("system.paging.state", "used")),
	)
	o.ObserveInt64(usage, int64(swap.Free),
		metric.WithAttributes(attribute.String("system.paging.state", "free")),
	)
	if swap.Total > 0 {
		o.ObserveFloat64(utilization, swap.UsedPercent/100.0)
	} else {
		o.ObserveFloat64(utilization, 0)
	}

	// Faults / operations from /proc/vmstat when available (Linux).
	// gopsutil SwapMemory multiplies these by page size; prefer raw counts.
	if major, minor, pin, pout, ok := readPagingCounters(); ok {
		if n, ok := uint64ToInt64(major); ok {
			o.ObserveInt64(faults, n,
				metric.WithAttributes(attribute.String("system.paging.fault.type", "major")),
			)
		}
		if n, ok := uint64ToInt64(minor); ok {
			o.ObserveInt64(faults, n,
				metric.WithAttributes(attribute.String("system.paging.fault.type", "minor")),
			)
		}
		if n, ok := uint64ToInt64(pin); ok {
			o.ObserveInt64(ops, n,
				metric.WithAttributes(attribute.String("system.paging.direction", "in")),
			)
		}
		if n, ok := uint64ToInt64(pout); ok {
			o.ObserveInt64(ops, n,
				metric.WithAttributes(attribute.String("system.paging.direction", "out")),
			)
		}
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
		if sc.fsExclude[p.Fstype] {
			continue
		}

		stat, err := disk.Usage(p.Mountpoint)
		if err != nil {
			continue
		}

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
	packets metric.Int64ObservableCounter,
	dropped metric.Int64ObservableCounter,
) {
	counters, err := net.IOCounters(true)
	if err != nil {
		sc.logger.Debug("network io error", "error", err)
		return
	}

	for _, stat := range counters {
		if !sc.includeNetInterface(stat.Name) {
			continue
		}

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
		o.ObserveInt64(packets, int64(stat.PacketsRecv), rxAttrs)
		o.ObserveInt64(packets, int64(stat.PacketsSent), txAttrs)
		o.ObserveInt64(dropped, int64(stat.Dropin), rxAttrs)
		o.ObserveInt64(dropped, int64(stat.Dropout), txAttrs)
	}
}

func (sc *SystemCollector) collectProcessCount(_ context.Context, o metric.Observer,
	count metric.Int64ObservableUpDownCounter,
) {
	procs, err := process.Processes()
	if err != nil {
		sc.logger.Debug("process list error", "error", err)
		return
	}

	byState := map[string]int64{}
	for _, p := range procs {
		statuses, err := p.Status()
		if err != nil || len(statuses) == 0 {
			continue
		}
		state := mapProcessState(statuses[0])
		byState[state]++
	}
	for state, n := range byState {
		o.ObserveInt64(count, n,
			metric.WithAttributes(attribute.String("process.state", state)),
		)
	}
}

func mapProcessState(s string) string {
	switch s {
	case process.Running:
		return "running"
	case process.Sleep, process.Idle, process.Wait, process.Lock, process.Blocked:
		return "sleeping"
	case process.Stop:
		return "stopped"
	case process.Zombie:
		return "defunct"
	default:
		if s == "" {
			return "unknown"
		}
		return s
	}
}

// cpuTimeSinceStart primes the CPU percent calculation so the first real call returns meaningful data.
func init() {
	go func() {
		_, _ = cpu.Percent(200*time.Millisecond, false)
	}()
}
