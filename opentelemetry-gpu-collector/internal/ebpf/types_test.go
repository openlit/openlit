package ebpf

import "testing"

func TestEventTypeConstants(t *testing.T) {
	if EventTypeKernelLaunch != 1 {
		t.Errorf("EventTypeKernelLaunch = %d, want 1", EventTypeKernelLaunch)
	}
	if EventTypeMalloc != 2 {
		t.Errorf("EventTypeMalloc = %d, want 2", EventTypeMalloc)
	}
	if EventTypeMemcpy != 3 {
		t.Errorf("EventTypeMemcpy = %d, want 3", EventTypeMemcpy)
	}
}

func TestKernelLaunchEventType(t *testing.T) {
	e := &KernelLaunchEvent{}
	if e.EventType() != EventTypeKernelLaunch {
		t.Errorf("KernelLaunchEvent.EventType() = %d, want %d", e.EventType(), EventTypeKernelLaunch)
	}
}

func TestMallocEventType(t *testing.T) {
	e := &MallocEvent{}
	if e.EventType() != EventTypeMalloc {
		t.Errorf("MallocEvent.EventType() = %d, want %d", e.EventType(), EventTypeMalloc)
	}
}

func TestMemcpyEventType(t *testing.T) {
	e := &MemcpyEvent{}
	if e.EventType() != EventTypeMemcpy {
		t.Errorf("MemcpyEvent.EventType() = %d, want %d", e.EventType(), EventTypeMemcpy)
	}
}

func TestMemcpyKindString(t *testing.T) {
	tests := []struct {
		kind uint8
		want string
	}{
		{0, "HostToHost"},
		{1, "HostToDevice"},
		{2, "DeviceToHost"},
		{3, "DeviceToDevice"},
		{4, "Unknown"},
		{255, "Unknown"},
	}

	for _, tt := range tests {
		got := MemcpyKindString(tt.kind)
		if got != tt.want {
			t.Errorf("MemcpyKindString(%d) = %q, want %q", tt.kind, got, tt.want)
		}
	}
}

func TestCUDAEventInterface(t *testing.T) {
	// Verify all event types satisfy the CUDAEvent interface at compile time.
	var _ CUDAEvent = (*KernelLaunchEvent)(nil)
	var _ CUDAEvent = (*MallocEvent)(nil)
	var _ CUDAEvent = (*MemcpyEvent)(nil)
}
