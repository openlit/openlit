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
