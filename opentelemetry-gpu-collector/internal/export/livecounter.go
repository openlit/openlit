package export

import (
	"os"
	"runtime"
	"strconv"
	"sync"

	"go.opentelemetry.io/otel/attribute"
)

const maxLiveCounterSeries = 16384

// liveCounter is a cumulative counter whose series can be dropped when the
// producing PID is gone. The OTel Go SDK keeps sync Int64Counter attribute
// sets forever; Prom remote-write then re-exports a frozen value and rate()
// stays 0. Observable counters plus this map omit dead PIDs so the series
// can go stale instead.
type liveCounter struct {
	mu     sync.Mutex
	series map[string]*liveCounterSeries
}

type liveCounterSeries struct {
	pid   uint32
	attrs []attribute.KeyValue
	value int64
}

func newLiveCounter() *liveCounter {
	return &liveCounter{series: make(map[string]*liveCounterSeries)}
}

func (c *liveCounter) add(pid uint32, n int64, attrs []attribute.KeyValue) {
	if c == nil || n == 0 {
		return
	}
	set := attribute.NewSet(attrs...)
	key := (&set).Encoded(attribute.DefaultEncoder())
	c.mu.Lock()
	defer c.mu.Unlock()
	s, ok := c.series[key]
	if !ok {
		if len(c.series) >= maxLiveCounterSeries {
			return
		}
		cloned := make([]attribute.KeyValue, len(attrs))
		copy(cloned, attrs)
		s = &liveCounterSeries{pid: pid, attrs: cloned}
		c.series[key] = s
	}
	s.value += n
}

func (c *liveCounter) collectLive(alive func(uint32) bool) (live []liveCounterSeries, deadPIDs []uint32) {
	if c == nil {
		return nil, nil
	}
	if alive == nil {
		alive = func(uint32) bool { return true }
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	dead := map[uint32]struct{}{}
	live = make([]liveCounterSeries, 0, len(c.series))
	for k, s := range c.series {
		if alive(s.pid) {
			live = append(live, liveCounterSeries{pid: s.pid, attrs: s.attrs, value: s.value})
			continue
		}
		delete(c.series, k)
		dead[s.pid] = struct{}{}
	}
	for pid := range dead {
		deadPIDs = append(deadPIDs, pid)
	}
	return live, deadPIDs
}

func pidExists(pid uint32) bool {
	if runtime.GOOS != "linux" {
		// eBPF metrics are Linux-only; keep series alive in unit tests elsewhere.
		return true
	}
	_, err := os.Stat("/proc/" + strconv.FormatUint(uint64(pid), 10))
	return err == nil
}
