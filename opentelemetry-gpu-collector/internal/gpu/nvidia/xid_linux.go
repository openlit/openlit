//go:build linux && (amd64 || arm64) && cgo

package nvidia

import (
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/NVIDIA/go-nvml/pkg/nvml"
)

// startXIDWatcher registers for critical XID events and increments xidCount.
func (d *Device) startXIDWatcher(logger *slog.Logger) {
	set, ret := nvml.EventSetCreate()
	if ret != nvml.SUCCESS {
		return
	}
	ret = d.handle.RegisterEvents(uint64(nvml.EventTypeXidCriticalError), set)
	if ret != nvml.SUCCESS {
		_ = set.Free()
		return
	}
	d.eventSet = &set
	d.xidDone = make(chan struct{})
	go func() {
		defer close(d.xidDone)
		for {
			if atomic.LoadInt32(&d.closed) == 1 {
				return
			}
			data, ret := set.Wait(500)
			if atomic.LoadInt32(&d.closed) == 1 {
				return
			}
			if ret == nvml.ERROR_TIMEOUT {
				continue
			}
			if ret != nvml.SUCCESS {
				return
			}
			if data.EventType&nvml.EventTypeXidCriticalError != 0 {
				atomic.AddInt64(&d.xidCount, 1)
				logger.Warn("NVIDIA XID critical error",
					"gpu", d.info.Index,
					"xid", data.EventData,
				)
			}
		}
	}()
}

// stopXIDWatcher signals the watcher, waits for it to exit, then frees the event set.
// Freeing before Wait returns is unsafe; the 500ms Wait timeout is the wake path.
func (d *Device) stopXIDWatcher() {
	atomic.StoreInt32(&d.closed, 1)
	if d.xidDone != nil {
		select {
		case <-d.xidDone:
		case <-time.After(2 * time.Second):
		}
	}
	if d.eventSet != nil {
		_ = d.eventSet.Free()
		d.eventSet = nil
	}
}
