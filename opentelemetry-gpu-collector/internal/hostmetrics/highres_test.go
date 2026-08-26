package hostmetrics

import (
	"testing"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
)

func TestHighResCPURingBuffer(t *testing.T) {
	h := &HighResCPU{
		buf:    make([]CPUSample, 4),
		cap:    4,
		stopCh: make(chan struct{}),
	}
	for i := 0; i < 6; i++ {
		h.push(CPUSample{
			Timestamp: time.Unix(int64(i), 0).UTC(),
			Times:     []cpu.TimesStat{{CPU: "cpu0", User: float64(i)}},
		})
	}
	snap := h.Snapshot()
	if len(snap) != 4 {
		t.Fatalf("len=%d want 4", len(snap))
	}
	// After 6 pushes into cap 4, oldest kept is sample 2.
	if snap[0].Timestamp.Unix() != 2 {
		t.Fatalf("oldest=%v want unix 2", snap[0].Timestamp)
	}
	if snap[3].Timestamp.Unix() != 5 {
		t.Fatalf("newest=%v want unix 5", snap[3].Timestamp)
	}
	h.Stop()
	h.Stop() // idempotent
}
