package cudaspans

// LaunchKind distinguishes kernel vs graph composite launches.
type LaunchKind string

const (
	LaunchKindKernel LaunchKind = "kernel"
	LaunchKindGraph  LaunchKind = "graph"
)

// Launch is one cudaLaunchKernel / ExC / GraphLaunch observation.
type Launch struct {
	PID                    uint32
	TID                    uint32
	StreamID               uint64
	DeviceUUID             string
	DeviceIndex            int
	KtimeNs                uint64
	Name                   string
	Kind                   LaunchKind
	GridX, GridY, GridZ    uint32
	BlockX, BlockY, BlockZ uint32
	SharedMemBytes         uint32
}

// ClosedSpan is one launch closed by a sync (or forced sync).
type ClosedSpan struct {
	StartNs     uint64
	EndNs       uint64
	PID         uint32
	TID         uint32
	StreamID    uint64
	DeviceUUID  string
	DeviceIndex int
	KernelName  string
	Kind        LaunchKind
	GridX, GridY, GridZ    uint32
	BlockX, BlockY, BlockZ uint32
}

// CloseLaunches converts launches with KtimeNs < endNs into ClosedSpans.
func CloseLaunches(launches []Launch, endNs uint64) (closed []ClosedSpan, kept []Launch) {
	if len(launches) == 0 {
		return nil, launches
	}
	kept = launches[:0]
	for _, l := range launches {
		if l.KtimeNs >= endNs {
			kept = append(kept, l)
			continue
		}
		closed = append(closed, ClosedSpan{
			StartNs:     l.KtimeNs,
			EndNs:       endNs,
			PID:         l.PID,
			TID:         l.TID,
			StreamID:    l.StreamID,
			DeviceUUID:  l.DeviceUUID,
			DeviceIndex: l.DeviceIndex,
			KernelName:  l.Name,
			Kind:        l.Kind,
			GridX:       l.GridX,
			GridY:       l.GridY,
			GridZ:       l.GridZ,
			BlockX:      l.BlockX,
			BlockY:      l.BlockY,
			BlockZ:      l.BlockZ,
		})
	}
	return closed, kept
}
