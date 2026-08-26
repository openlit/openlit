package ebpf

// Event type constants shared across platforms.
const (
	EventTypeKernelLaunch = 1
	EventTypeMalloc       = 2
	EventTypeMemcpy       = 3
	EventTypeSync         = 4
	EventTypeSyncDevice   = 5
	EventTypeSetDevice    = 6
	EventTypeFree         = 7
	EventTypeGraphLaunch  = 8
)

// CUDAEvent is the common interface for parsed ring buffer events.
type CUDAEvent interface {
	EventType() uint8
	ProcessPID() uint32
}

type eventMeta struct {
	PID       uint32
	TID       uint32
	StreamID  uint64
	KtimeNs   uint64
	DeviceIdx uint16 // 0xffff = unknown
}

type KernelLaunchEvent struct {
	eventMeta
	KernelAddr     uint64
	GridX          uint32
	GridY          uint32
	GridZ          uint32
	BlockX         uint32
	BlockY         uint32
	BlockZ         uint32
	SharedMemBytes uint32
	KernelName     string
}

func (e *KernelLaunchEvent) EventType() uint8   { return EventTypeKernelLaunch }
func (e *KernelLaunchEvent) ProcessPID() uint32 { return e.PID }

type MallocEvent struct {
	eventMeta
	Size uint64
}

func (e *MallocEvent) EventType() uint8   { return EventTypeMalloc }
func (e *MallocEvent) ProcessPID() uint32 { return e.PID }

type MemcpyEvent struct {
	eventMeta
	Size uint64
	Kind uint8
}

func (e *MemcpyEvent) EventType() uint8   { return EventTypeMemcpy }
func (e *MemcpyEvent) ProcessPID() uint32 { return e.PID }

type SyncEvent struct {
	eventMeta
	DeviceWide bool
}

func (e *SyncEvent) EventType() uint8 {
	if e.DeviceWide {
		return EventTypeSyncDevice
	}
	return EventTypeSync
}
func (e *SyncEvent) ProcessPID() uint32 { return e.PID }

type SetDeviceEvent struct {
	eventMeta
	Device int32
}

func (e *SetDeviceEvent) EventType() uint8   { return EventTypeSetDevice }
func (e *SetDeviceEvent) ProcessPID() uint32 { return e.PID }

type FreeEvent struct {
	eventMeta
}

func (e *FreeEvent) EventType() uint8   { return EventTypeFree }
func (e *FreeEvent) ProcessPID() uint32 { return e.PID }

// GraphLaunchEvent is one CUDA graph replay (cudaGraphLaunch / cuGraphLaunch).
// One call represents an unknown number of kernels; there is no grid/block data.
type GraphLaunchEvent struct {
	eventMeta
}

func (e *GraphLaunchEvent) EventType() uint8   { return EventTypeGraphLaunch }
func (e *GraphLaunchEvent) ProcessPID() uint32 { return e.PID }

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

// MultiplexHandlers returns a handler that fans out to all given handlers.
func MultiplexHandlers(handlers ...EventHandler) EventHandler {
	return func(ev CUDAEvent) {
		for _, h := range handlers {
			if h != nil {
				h(ev)
			}
		}
	}
}
