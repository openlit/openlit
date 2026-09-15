package cudaspans

import "testing"

func TestCloseLaunches(t *testing.T) {
	launches := []Launch{
		{PID: 1, TID: 2, StreamID: 3, KtimeNs: 100, Name: "a"},
		{PID: 1, TID: 2, StreamID: 3, KtimeNs: 200, Name: "b"},
		{PID: 1, TID: 2, StreamID: 3, KtimeNs: 300, Name: "c"},
	}
	closed, kept := CloseLaunches(launches, 250)
	if len(closed) != 2 {
		t.Fatalf("closed=%d want 2", len(closed))
	}
	if closed[0].KernelName != "a" || closed[1].KernelName != "b" {
		t.Fatalf("names %#v", closed)
	}
	if closed[0].EndNs != 250 || closed[0].StartNs != 100 {
		t.Fatalf("span0 %#v", closed[0])
	}
	if len(kept) != 1 || kept[0].Name != "c" {
		t.Fatalf("kept %#v", kept)
	}
}

func TestDeviceResolverSoleGPU(t *testing.T) {
	// Resolver without devices: no sole fallback.
	r := NewDeviceResolver(nil)
	if r.ResolveIndex(1, 1) != -1 {
		t.Fatal("expected no sole index")
	}
	r.SetDeviceIndexUUID(0, "gpu-a")
	r.soleIndex = 0
	if got := r.ResolveUUID(1, 1); got != "gpu-a" {
		t.Fatalf("got %q", got)
	}
	r.NoteSetDevice(1, 2, 0)
	if got := r.ResolveUUID(1, 2); got != "gpu-a" {
		t.Fatalf("got %q", got)
	}
}

func TestDeviceResolverMultiGPUDefaultsToCUDAZero(t *testing.T) {
	r := NewDeviceResolver(nil)
	r.SetDeviceIndexUUID(0, "gpu-a")
	r.SetDeviceIndexUUID(1, "gpu-b")
	if got := r.ResolveIndex(1, 1); got != 0 {
		t.Fatalf("ResolveIndex = %d, want 0 (CUDA default current device)", got)
	}
	if got := r.ResolveUUID(1, 1); got != "gpu-a" {
		t.Fatalf("ResolveUUID = %q, want gpu-a", got)
	}
	r.NoteSetDevice(1, 1, 1)
	if got := r.ResolveIndex(1, 1); got != 1 {
		t.Fatalf("after SetDevice ResolveIndex = %d, want 1", got)
	}
	if got := r.ResolveUUID(1, 1); got != "gpu-b" {
		t.Fatalf("after SetDevice ResolveUUID = %q, want gpu-b", got)
	}
	if idx, ok := r.IndexForUUID("gpu-b"); !ok || idx != 1 {
		t.Fatalf("IndexForUUID(gpu-b) = %d ok=%v", idx, ok)
	}
}
