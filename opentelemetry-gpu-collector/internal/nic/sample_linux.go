//go:build linux

package nic

import (
	"log/slog"

	gopsutilnet "github.com/shirou/gopsutil/v4/net"
)

// sampleIfaces collects per-interface snapshots for allowlisted NICs.
func sampleIfaces(allow, exclude []string, rdmaEnabled bool, rdmaCounters []string, logger *slog.Logger) ([]IfaceSnapshot, error) {
	names, err := listIfaces()
	if err != nil {
		// Fall back to gopsutil interface list.
		counters, gerr := gopsutilnet.IOCounters(true)
		if gerr != nil {
			return nil, err
		}
		out := make([]IfaceSnapshot, 0, len(counters))
		for _, c := range counters {
			if !includeIface(c.Name, allow, exclude) {
				continue
			}
			out = append(out, IfaceSnapshot{
				Name:      c.Name,
				RxBytes:   c.BytesRecv,
				TxBytes:   c.BytesSent,
				RxPackets: c.PacketsRecv,
				TxPackets: c.PacketsSent,
				RxErrors:  c.Errin,
				TxErrors:  c.Errout,
				RxDropped: c.Dropin,
				TxDropped: c.Dropout,
			})
		}
		return out, nil
	}

	allowRDMA := rdmaAllowSet(rdmaCounters)
	out := make([]IfaceSnapshot, 0, len(names))
	for _, name := range names {
		if !includeIface(name, allow, exclude) {
			continue
		}
		snap := IfaceSnapshot{
			Name:              name,
			BandwidthLimitBps: readSpeedBps(name),
			Up:                readOperstate(name),
		}
		readSysfsStats(&snap)

		// Prefer gopsutil if sysfs stats are all zero but gopsutil has data.
		if snap.RxBytes == 0 && snap.TxBytes == 0 {
			if counters, err := gopsutilnet.IOCounters(true); err == nil {
				for _, c := range counters {
					if c.Name == name {
						snap.RxBytes = c.BytesRecv
						snap.TxBytes = c.BytesSent
						snap.RxPackets = c.PacketsRecv
						snap.TxPackets = c.PacketsSent
						snap.RxErrors = c.Errin
						snap.TxErrors = c.Errout
						snap.RxDropped = c.Dropin
						snap.TxDropped = c.Dropout
						break
					}
				}
			}
		}

		if et, err := readEthtoolStats(name); err == nil && len(et) > 0 {
			snap.Ethtool = et
		} else if err != nil && logger != nil {
			logger.Debug("ethtool stats unavailable", "iface", name, "error", err)
		}

		if rdmaEnabled {
			if rdma := readRDMACounters(name, allowRDMA); len(rdma) > 0 {
				snap.RDMA = rdma
			}
		}

		out = append(out, snap)
	}
	return out, nil
}
