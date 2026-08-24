package nic

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
)

// Collector emits per-NIC hw.network.* metrics (and optional RDMA extensions).
type Collector struct {
	logger      *slog.Logger
	allow       []string
	exclude     []string
	rdmaEnabled bool
	rdmaAllow   []string
	reg         []metric.Registration

	mu       sync.Mutex
	prev     map[string]ifacePrev
	prevTime time.Time
}

type ifacePrev struct {
	rxBytes, txBytes uint64
	at               time.Time
}

// NewCollector registers hw.network.* instruments on meter otelcol.nic.
// Soft-fail: sampling errors are logged; NewCollector itself only fails on
// instrument registration errors.
func NewCollector(provider *sdkmetric.MeterProvider, cfg *config.Config, logger *slog.Logger) (*Collector, error) {
	if logger == nil {
		logger = slog.Default()
	}
	c := &Collector{
		logger:      logger,
		allow:       append([]string(nil), cfg.NetInterfaces...),
		exclude:     append([]string(nil), cfg.NetInterfaceExclude...),
		rdmaEnabled: cfg.RDMAEnabled,
		rdmaAllow:   append([]string(nil), cfg.RDMACounters...),
		prev:        make(map[string]ifacePrev),
	}

	meter := provider.Meter("otelcol.nic",
		metric.WithInstrumentationVersion("1.0.0"),
	)

	netIO, err := meter.Int64ObservableCounter("hw.network.io",
		metric.WithDescription("Received and transmitted network traffic in bytes"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.network.io: %w", err)
	}

	netPackets, err := meter.Int64ObservableCounter("hw.network.packets",
		metric.WithDescription("Received and transmitted network traffic in packets"),
		metric.WithUnit("{packet}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.network.packets: %w", err)
	}

	bwLimit, err := meter.Int64ObservableUpDownCounter("hw.network.bandwidth.limit",
		metric.WithDescription("Network interface bandwidth limit (link speed)"),
		metric.WithUnit("By/s"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.network.bandwidth.limit: %w", err)
	}

	bwUtil, err := meter.Float64ObservableGauge("hw.network.bandwidth.utilization",
		metric.WithDescription("Utilization of the network bandwidth as a fraction"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.network.bandwidth.utilization: %w", err)
	}

	netUp, err := meter.Int64ObservableUpDownCounter("hw.network.up",
		metric.WithDescription("Network interface link status (1=up, 0=down)"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.network.up: %w", err)
	}

	hwErrors, err := meter.Int64ObservableCounter("hw.errors",
		metric.WithDescription("Hardware errors encountered by the network adapter"),
		metric.WithUnit("{error}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.errors: %w", err)
	}

	rdmaIO, err := meter.Int64ObservableCounter("hw.network.rdma.io",
		metric.WithDescription("RDMA port data bytes (port_*_data counters × 4 for lane width)"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.network.rdma.io: %w", err)
	}

	rdmaPkts, err := meter.Int64ObservableCounter("hw.network.rdma.packets",
		metric.WithDescription("RDMA port packets"),
		metric.WithUnit("{packet}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.network.rdma.packets: %w", err)
	}

	rdmaCong, err := meter.Int64ObservableCounter("hw.network.rdma.congestion.events",
		metric.WithDescription("RDMA congestion notification events"),
		metric.WithUnit("{event}"),
	)
	if err != nil {
		return nil, fmt.Errorf("creating hw.network.rdma.congestion.events: %w", err)
	}

	reg, err := meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			c.observe(ctx, o, netIO, netPackets, bwLimit, bwUtil, netUp, hwErrors, rdmaIO, rdmaPkts, rdmaCong)
			return nil
		},
		netIO, netPackets, bwLimit, bwUtil, netUp, hwErrors, rdmaIO, rdmaPkts, rdmaCong,
	)
	if err != nil {
		return nil, fmt.Errorf("registering nic callback: %w", err)
	}
	c.reg = append(c.reg, reg)
	logger.Info("NIC metrics collector initialized",
		"rdma", cfg.RDMAEnabled,
		"allow", len(cfg.NetInterfaces),
		"exclude", len(cfg.NetInterfaceExclude),
	)
	return c, nil
}

// Close unregisters callbacks.
func (c *Collector) Close() {
	for _, r := range c.reg {
		_ = r.Unregister()
	}
}

func (c *Collector) observe(
	_ context.Context,
	o metric.Observer,
	netIO metric.Int64ObservableCounter,
	netPackets metric.Int64ObservableCounter,
	bwLimit metric.Int64ObservableUpDownCounter,
	bwUtil metric.Float64ObservableGauge,
	netUp metric.Int64ObservableUpDownCounter,
	hwErrors metric.Int64ObservableCounter,
	rdmaIO metric.Int64ObservableCounter,
	rdmaPkts metric.Int64ObservableCounter,
	rdmaCong metric.Int64ObservableCounter,
) {
	snaps, err := sampleIfaces(c.allow, c.exclude, c.rdmaEnabled, c.rdmaAllow, c.logger)
	if err != nil {
		c.logger.Debug("nic sample error", "error", err)
		return
	}

	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()

	for _, s := range snaps {
		base := []attribute.KeyValue{
			attribute.String("hw.id", s.Name),
			attribute.String("hw.name", s.Name),
			attribute.String("hw.type", "network"),
			// Align with system.network.* for joins when both are enabled.
			attribute.String("network.interface.name", s.Name),
		}
		rxAttrs := metric.WithAttributes(append(base,
			attribute.String("network.io.direction", "receive"),
		)...)
		txAttrs := metric.WithAttributes(append(base,
			attribute.String("network.io.direction", "transmit"),
		)...)
		baseAttrs := metric.WithAttributes(base...)

		o.ObserveInt64(netIO, int64(s.RxBytes), rxAttrs)
		o.ObserveInt64(netIO, int64(s.TxBytes), txAttrs)
		o.ObserveInt64(netPackets, int64(s.RxPackets), rxAttrs)
		o.ObserveInt64(netPackets, int64(s.TxPackets), txAttrs)

		if s.BandwidthLimitBps > 0 {
			o.ObserveInt64(bwLimit, s.BandwidthLimitBps, baseAttrs)
		}

		up := int64(0)
		if s.Up {
			up = 1
		}
		o.ObserveInt64(netUp, up, baseAttrs)

		o.ObserveInt64(hwErrors, int64(s.RxErrors), metric.WithAttributes(append(base,
			attribute.String("network.io.direction", "receive"),
			attribute.String("error.type", "receive"),
		)...))
		o.ObserveInt64(hwErrors, int64(s.TxErrors), metric.WithAttributes(append(base,
			attribute.String("network.io.direction", "transmit"),
			attribute.String("error.type", "transmit"),
		)...))
		if s.RxDropped > 0 {
			o.ObserveInt64(hwErrors, int64(s.RxDropped), metric.WithAttributes(append(base,
				attribute.String("network.io.direction", "receive"),
				attribute.String("error.type", "dropped"),
			)...))
		}
		if s.TxDropped > 0 {
			o.ObserveInt64(hwErrors, int64(s.TxDropped), metric.WithAttributes(append(base,
				attribute.String("network.io.direction", "transmit"),
				attribute.String("error.type", "dropped"),
			)...))
		}
		for name, val := range s.Ethtool {
			if val == 0 {
				continue
			}
			errType, ok := ethtoolErrorType(name)
			if !ok {
				continue
			}
			dir := "receive"
			if strings.HasPrefix(strings.ToLower(name), "tx_") {
				dir = "transmit"
			}
			o.ObserveInt64(hwErrors, int64(val), metric.WithAttributes(append(base,
				attribute.String("network.io.direction", dir),
				attribute.String("error.type", errType),
			)...))
		}

		// Bandwidth utilization needs a rate window; skip on first sample.
		if s.BandwidthLimitBps > 0 {
			if prev, ok := c.prev[s.Name]; ok && !prev.at.IsZero() {
				dt := now.Sub(prev.at).Seconds()
				if dt > 0 {
					rxRate := float64(s.RxBytes-prev.rxBytes) / dt
					txRate := float64(s.TxBytes-prev.txBytes) / dt
					limit := float64(s.BandwidthLimitBps)
					if limit > 0 {
						// Report the max of rx/tx utilization against the full-duplex limit.
						util := rxRate / limit
						if tx := txRate / limit; tx > util {
							util = tx
						}
						if util < 0 {
							util = 0
						}
						o.ObserveFloat64(bwUtil, util, baseAttrs)
					}
				}
			}
		}
		c.prev[s.Name] = ifacePrev{rxBytes: s.RxBytes, txBytes: s.TxBytes, at: now}

		if !c.rdmaEnabled || len(s.RDMA) == 0 {
			continue
		}
		c.observeRDMA(o, s, base, rdmaIO, rdmaPkts, rdmaCong, hwErrors)
	}
	c.prevTime = now
}

func (c *Collector) observeRDMA(
	o metric.Observer,
	s IfaceSnapshot,
	base []attribute.KeyValue,
	rdmaIO metric.Int64ObservableCounter,
	rdmaPkts metric.Int64ObservableCounter,
	rdmaCong metric.Int64ObservableCounter,
	hwErrors metric.Int64ObservableCounter,
) {
	get := func(keys ...string) (uint64, bool) {
		for _, k := range keys {
			if v, ok := s.RDMA[k]; ok {
				return v, true
			}
			// Case-insensitive fallback.
			lk := toLowerASCII(k)
			for name, v := range s.RDMA {
				if toLowerASCII(name) == lk {
					return v, true
				}
			}
		}
		return 0, false
	}

	rxAttrs := metric.WithAttributes(append(base, attribute.String("network.io.direction", "receive"))...)
	txAttrs := metric.WithAttributes(append(base, attribute.String("network.io.direction", "transmit"))...)

	// port_*_data are in 4-byte units (InfiniBand lane width).
	if v, ok := get("port_rcv_data"); ok {
		if n, ok := uint64ToInt64Scaled(v, rdmaLaneWidth); ok {
			o.ObserveInt64(rdmaIO, n, rxAttrs)
		}
	}
	if v, ok := get("port_xmit_data"); ok {
		if n, ok := uint64ToInt64Scaled(v, rdmaLaneWidth); ok {
			o.ObserveInt64(rdmaIO, n, txAttrs)
		}
	}
	if v, ok := get("port_rcv_packets"); ok {
		if n, ok := uint64ToInt64(v); ok {
			o.ObserveInt64(rdmaPkts, n, rxAttrs)
		}
	}
	if v, ok := get("port_xmit_packets"); ok {
		if n, ok := uint64ToInt64(v); ok {
			o.ObserveInt64(rdmaPkts, n, txAttrs)
		}
	}

	observeCong := func(keys []string, congType string) {
		if v, ok := get(keys...); ok {
			if n, ok := uint64ToInt64(v); ok {
				o.ObserveInt64(rdmaCong, n, metric.WithAttributes(append(base,
					attribute.String("hw.network.rdma.congestion.type", congType),
				)...))
			}
		}
	}
	observeCong([]string{"NPCnpSent", "np_cnp_sent"}, "cnp_sent")
	observeCong([]string{"NPCnpHandled", "rp_cnp_handled", "np_cnp_handled"}, "cnp_handled")
	observeCong([]string{"NPEcnMarkedRocePackets", "np_ecn_marked_roce_packets"}, "ecn_marked")

	observeErr := func(keys []string, errType string) {
		if v, ok := get(keys...); ok {
			if n, ok := uint64ToInt64(v); ok {
				o.ObserveInt64(hwErrors, n, metric.WithAttributes(append(base,
					attribute.String("error.type", errType),
				)...))
			}
		}
	}
	observeErr([]string{"symbol_error"}, "symbol")
	observeErr([]string{"link_downed"}, "link_downed")
	observeErr([]string{"link_error_recovery"}, "link_error_recovery")
	observeErr([]string{"port_xmit_discards"}, "rdma_xmit_discards")
}

// ethtoolErrorType maps driver ethtool counter names to hw.errors error.type values.
// Only known error-like counters are exported to avoid high-cardinality noise.
func ethtoolErrorType(name string) (string, bool) {
	switch strings.ToLower(name) {
	case "rx_crc_errors", "rx_crc_error", "rx_fcs_errors":
		return "crc", true
	case "rx_fifo_errors", "tx_fifo_errors":
		return "fifo", true
	case "rx_missed_errors":
		return "missed", true
	case "rx_length_errors", "rx_over_errors", "rx_frame_errors":
		return "frame", true
	case "tx_aborted_errors", "tx_carrier_errors", "tx_window_errors", "tx_heartbeat_errors":
		return "transmit", true
	default:
		return "", false
	}
}

// uint64ToInt64 converts v to int64 when it fits. OTel int64 instruments cannot
// represent values above math.MaxInt64.
func uint64ToInt64(v uint64) (int64, bool) {
	if v > math.MaxInt64 {
		return 0, false
	}
	return int64(v), true
}

func uint64ToInt64Scaled(v, scale uint64) (int64, bool) {
	if scale == 0 {
		return uint64ToInt64(v)
	}
	if v > math.MaxInt64/scale {
		return 0, false
	}
	return int64(v * scale), true
}
