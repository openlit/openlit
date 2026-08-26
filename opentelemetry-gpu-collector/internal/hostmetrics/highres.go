package hostmetrics

import (
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
)

const (
	highResInterval = 100 * time.Millisecond
	highResWindow   = time.Minute
	highResCapacity = int(highResWindow / highResInterval) // 600
)

// CPUSample is one high-resolution CPU times snapshot.
type CPUSample struct {
	Timestamp time.Time   `json:"timestamp"`
	Times     []cpu.TimesStat `json:"times"`
}

// HighResCPU samples cpu.Times into a ring buffer for on-demand RPC.
// It does not emit OTel metrics (avoids high-cardinality 100ms series).
type HighResCPU struct {
	mu      sync.RWMutex
	buf     []CPUSample
	cap     int
	pos     int
	count   int
	stopCh  chan struct{}
	stopped bool
}

// Snapshot returns a copy of samples within the recent window (oldest first).
func (h *HighResCPU) Snapshot() []CPUSample {
	if h == nil {
		return nil
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.count == 0 {
		return nil
	}
	out := make([]CPUSample, 0, h.count)
	start := 0
	if h.count == h.cap {
		start = h.pos
	}
	for i := 0; i < h.count; i++ {
		idx := (start + i) % h.cap
		out = append(out, h.buf[idx])
	}
	return out
}

// Stop terminates the background sampler.
func (h *HighResCPU) Stop() {
	if h == nil {
		return
	}
	h.mu.Lock()
	if h.stopped {
		h.mu.Unlock()
		return
	}
	h.stopped = true
	close(h.stopCh)
	h.mu.Unlock()
}

func (h *HighResCPU) push(s CPUSample) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.cap == 0 {
		return
	}
	h.buf[h.pos] = s
	h.pos = (h.pos + 1) % h.cap
	if h.count < h.cap {
		h.count++
	}
}
