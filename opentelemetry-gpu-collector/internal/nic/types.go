package nic

// IfaceSnapshot holds per-interface counters and link state for one scrape.
type IfaceSnapshot struct {
	Name string

	RxBytes, TxBytes     uint64
	RxPackets, TxPackets uint64
	RxErrors, TxErrors   uint64
	RxDropped, TxDropped uint64

	// BandwidthLimitBps is link speed in bytes/second (0 if unknown).
	BandwidthLimitBps int64
	// Up is true when operstate is "up".
	Up bool

	// Ethtool holds optional driver-specific stats (may be empty).
	Ethtool map[string]uint64

	// RDMA holds InfiniBand/RoCE counters when present.
	RDMA map[string]uint64
}

// DefaultRDMACounters is the default allowlist when Config.RDMACounters is empty.
// Names are matched case-insensitively against sysfs counter file names.
var DefaultRDMACounters = []string{
	"port_xmit_data",
	"port_rcv_data",
	"port_xmit_packets",
	"port_rcv_packets",
	"port_xmit_discards",
	"symbol_error",
	"link_error_recovery",
	"link_downed",
	"NPCnpSent",
	"NPCnpHandled",
	"NPEcnMarkedRocePackets",
	// Common lowercase sysfs spellings (mlx5 / RoCE).
	"np_cnp_sent",
	"rp_cnp_handled",
	"np_ecn_marked_roce_packets",
}

// rdmaLaneWidth converts InfiniBand port_*_data counters (4-byte units) to bytes.
// See https://www.kernel.org/doc/Documentation/ABI/stable/sysfs-class-infiniband
const rdmaLaneWidth = 4
