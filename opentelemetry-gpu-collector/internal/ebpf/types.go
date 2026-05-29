package ebpf

// Event type constants shared across platforms.
const (
	EventTypeKernelLaunch = 1
	EventTypeMalloc       = 2
	EventTypeMemcpy       = 3
)

// CUDAEvent is the common interface for parsed ring buffer events.
type CUDAEvent interface {
	EventType() uint8
}

type KernelLaunchEvent struct {
	PID        uint32
	KernelAddr uint64
	GridX      uint32
	GridY      uint32
	GridZ      uint32
	BlockX     uint32
	BlockY     uint32
	BlockZ     uint32
	KernelName string
}

func (e *KernelLaunchEvent) EventType() uint8 { return EventTypeKernelLaunch }

type MallocEvent struct {
	PID  uint32
	Size uint64
}

func (e *MallocEvent) EventType() uint8 { return EventTypeMalloc }

type MemcpyEvent struct {
	PID  uint32
	Size uint64
	Kind uint8
}

func (e *MemcpyEvent) EventType() uint8 { return EventTypeMemcpy }

// MemcpyKindString returns a human-readable string for cudaMemcpyKind.
func MemcpyKindString(kind uint8) string {
	switch kind {
	case 0:
		return "HostToHost"
	case 1:
		return "HostToDevice"
	case 2:
		return "DeviceToHost"
	case 3:
		return "DeviceToDevice"
	default:
		return "Unknown"
	}
}

// EventHandler is called for each parsed CUDA event.
type EventHandler func(CUDAEvent)
