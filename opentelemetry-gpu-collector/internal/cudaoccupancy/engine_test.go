package cudaoccupancy

import "testing"

func TestTakeClosedSpansOnSync(t *testing.T) {
	e := NewEngine(map[string]uint64{"gpu-a": 64}, nil)
	e.HandleLaunch(KernelLaunch{
		PID: 1, TID: 1, StreamID: 9, DeviceUUID: "gpu-a", KtimeNs: 100,
		Name: "k", GridX: 1, GridY: 1, GridZ: 1, BlockX: 32, BlockY: 1, BlockZ: 1,
	})
	e.HandleSync(SyncEvent{PID: 1, TID: 1, StreamID: 9, DeviceUUID: "gpu-a", KtimeNs: 200})
	closed := e.TakeClosedSpans()
	if len(closed) != 1 {
		t.Fatalf("closed=%d", len(closed))
	}
	if closed[0].KernelName != "k" || closed[0].StartNs != 100 || closed[0].EndNs != 200 {
		t.Fatalf("%#v", closed[0])
	}
	if len(e.TakeClosedSpans()) != 0 {
		t.Fatal("expected empty after take")
	}
}

func TestMergeIntervals(t *testing.T) {
	if got := MergeIntervals(nil); got != 0 {
		t.Fatalf("empty: %d", got)
	}
	got := MergeIntervals([][2]uint64{{10, 20}, {15, 25}, {30, 40}})
	// union [10,25)+[30,40) = 15+10 = 25
	if got != 25 {
		t.Fatalf("got %d want 25", got)
	}
}

func TestBuildKernelSpanAvgThreads(t *testing.T) {
	launches := []KernelLaunch{
		{KtimeNs: 100, GridX: 2, GridY: 1, GridZ: 1, BlockX: 32, BlockY: 1, BlockZ: 1},
		{KtimeNs: 200, GridX: 1, GridY: 1, GridZ: 1, BlockX: 32, BlockY: 1, BlockZ: 1},
	}
	span := buildKernelSpan(launches, 1000)
	if span == nil || span.numKernels != 2 {
		t.Fatalf("span=%+v", span)
	}
	// (64 + 32) / 2 = 48
	if span.avgThreadCount != 48 {
		t.Fatalf("avg=%d", span.avgThreadCount)
	}
	if span.endKtime != 1000 || span.startKtime != 100 {
		t.Fatalf("times start=%d end=%d", span.startKtime, span.endKtime)
	}
}

func TestCoreUsageClampAndNormalize(t *testing.T) {
	e := NewEngine(map[string]uint64{"gpu-a": 50}, nil)
	// Control time
	var now uint64 = 1_000_000_000 // 1s
	e.nowFn = func() uint64 { return now }
	e.lastFlushKtime = 0

	// First flush establishes baseline
	_ = e.GetAndFlush()

	// Launch 100 threads at t=1s, sync at t=2s, flush at t=3s (2s window from last flush)
	now = 1_000_000_000
	e.HandleLaunch(KernelLaunch{
		PID: 1, StreamID: 1, DeviceUUID: "gpu-a", KtimeNs: now,
		GridX: 100, GridY: 1, GridZ: 1, BlockX: 1, BlockY: 1, BlockZ: 1,
	})
	now = 2_000_000_000
	e.HandleSync(SyncEvent{PID: 1, StreamID: 1, DeviceUUID: "gpu-a", KtimeNs: now})

	now = 3_000_000_000 // interval = 2s from first flush end (~1s)
	// After first GetAndFlush, lastFlush was ~1s. Wait — first call set lastFlush=1s.
	// Actually first GetAndFlush at now=1s set lastFlush=1s.
	// Second at now=3s → interval 2s. Span [1s,2s] clamped → 1s * min(100,50) = 50 thread-seconds
	// UsedCores_raw = 50 / 2 = 25
	res := e.GetAndFlush()
	if len(res.Processes) != 1 {
		t.Fatalf("processes: %+v", res.Processes)
	}
	p := res.Processes[0]
	if p.RawUsedCores < 24 || p.RawUsedCores > 26 {
		t.Fatalf("raw cores=%v want ~25", p.RawUsedCores)
	}
	if p.UsedCores > p.RawUsedCores+0.01 {
		t.Fatalf("normalized should be <= raw: %v vs %v", p.UsedCores, p.RawUsedCores)
	}
}

func TestMultiProcessNormalization(t *testing.T) {
	e := NewEngine(map[string]uint64{"gpu-a": 100}, nil)
	var now uint64 = 1_000_000_000
	e.nowFn = func() uint64 { return now }
	_ = e.GetAndFlush()

	// Two processes each claim 80 cores for full 1s interval
	now = 2_000_000_000
	for _, pid := range []uint32{1, 2} {
		e.HandleLaunch(KernelLaunch{
			PID: pid, StreamID: uint64(pid), DeviceUUID: "gpu-a", KtimeNs: 1_000_000_000,
			GridX: 80, GridY: 1, GridZ: 1, BlockX: 1, BlockY: 1, BlockZ: 1,
		})
		e.HandleSync(SyncEvent{PID: pid, StreamID: uint64(pid), DeviceUUID: "gpu-a", KtimeNs: 2_000_000_000})
	}
	res := e.GetAndFlush()
	var sum float64
	for _, p := range res.Processes {
		sum += p.UsedCores
	}
	if sum > 100.01 {
		t.Fatalf("sum UsedCores=%v exceeds core limit 100", sum)
	}
	if len(res.Processes) != 2 {
		t.Fatalf("want 2 processes, got %+v", res.Processes)
	}
}

func TestDeviceSyncFanOut(t *testing.T) {
	e := NewEngine(map[string]uint64{"gpu-a": 64}, nil)
	var now uint64 = 100
	e.nowFn = func() uint64 { return now }
	_ = e.GetAndFlush()

	e.HandleLaunch(KernelLaunch{
		PID: 7, StreamID: 42, DeviceUUID: "gpu-a", KtimeNs: 100,
		GridX: 1, GridY: 1, GridZ: 1, BlockX: 32, BlockY: 1, BlockZ: 1,
	})
	e.HandleLaunch(KernelLaunch{
		PID: 7, StreamID: 43, DeviceUUID: "gpu-a", KtimeNs: 100,
		GridX: 1, GridY: 1, GridZ: 1, BlockX: 32, BlockY: 1, BlockZ: 1,
	})
	now = 200
	e.HandleSync(SyncEvent{PID: 7, DeviceUUID: "gpu-a", KtimeNs: 200, DeviceWide: true})

	now = 300
	res := e.GetAndFlush()
	if len(res.Processes) != 1 {
		t.Fatalf("got %+v", res.Processes)
	}
	if res.Processes[0].ActiveTime <= 0 {
		t.Fatalf("expected positive active time: %+v", res.Processes[0])
	}
}

func TestDeviceSyncWithoutSetDevice(t *testing.T) {
	e := NewEngine(map[string]uint64{"gpu-a": 64}, nil)
	var now uint64 = 100
	e.nowFn = func() uint64 { return now }
	_ = e.GetAndFlush()

	e.HandleLaunch(KernelLaunch{
		PID: 9, StreamID: 1, DeviceUUID: "gpu-a", KtimeNs: 100,
		GridX: 1, GridY: 1, GridZ: 1, BlockX: 16, BlockY: 1, BlockZ: 1,
	})
	now = 200
	// Empty UUID + DeviceWide: must still close spans for the PID.
	e.HandleSync(SyncEvent{PID: 9, KtimeNs: 200, DeviceWide: true})

	now = 300
	res := e.GetAndFlush()
	if len(res.Processes) != 1 {
		t.Fatalf("got %+v", res.Processes)
	}
}

func TestStreamLimitIsPerPID(t *testing.T) {
	e := NewEngine(map[string]uint64{"gpu-a": 64}, nil)
	e.maxActiveStreams = 2
	var now uint64 = 1
	e.nowFn = func() uint64 { return now }

	for sid := uint64(1); sid <= 2; sid++ {
		e.HandleLaunch(KernelLaunch{
			PID: 1, StreamID: sid, DeviceUUID: "gpu-a", KtimeNs: now,
			GridX: 1, GridY: 1, GridZ: 1, BlockX: 1, BlockY: 1, BlockZ: 1,
		})
	}
	e.HandleLaunch(KernelLaunch{
		PID: 1, StreamID: 3, DeviceUUID: "gpu-a", KtimeNs: now,
		GridX: 1, GridY: 1, GridZ: 1, BlockX: 1, BlockY: 1, BlockZ: 1,
	})
	if e.RejectedStreams == 0 {
		t.Fatal("expected reject for PID 1 over limit")
	}
	before := e.RejectedStreams
	e.HandleLaunch(KernelLaunch{
		PID: 2, StreamID: 1, DeviceUUID: "gpu-a", KtimeNs: now,
		GridX: 1, GridY: 1, GridZ: 1, BlockX: 1, BlockY: 1, BlockZ: 1,
	})
	if e.RejectedStreams != before {
		t.Fatal("PID 2 should not share PID 1 stream quota")
	}
}

func TestUint64ThreadProduct(t *testing.T) {
	// Large grid that would overflow uint32 if multiplied wrongly
	launches := []KernelLaunch{{
		KtimeNs: 1,
		GridX:   1 << 20, GridY: 1 << 10, GridZ: 1,
		BlockX: 256, BlockY: 1, BlockZ: 1,
	}}
	span := buildKernelSpan(launches, 10)
	if span == nil {
		t.Fatal("nil span")
	}
	want := uint64(1<<20) * uint64(1<<10) * 256
	if span.avgThreadCount != want {
		t.Fatalf("got %d want %d", span.avgThreadCount, want)
	}
}
