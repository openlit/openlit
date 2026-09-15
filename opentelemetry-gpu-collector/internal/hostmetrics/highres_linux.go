//go:build linux

package hostmetrics

import (
	"log/slog"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
)

// NewHighResCPU starts a background goroutine that samples cpu.Times every 100ms
// into a 1-minute ring buffer. Soft-fails if the first sample fails.
func NewHighResCPU(logger *slog.Logger) (*HighResCPU, error) {
	if logger == nil {
		logger = slog.Default()
	}
	times, err := cpu.Times(true)
	if err != nil {
		logger.Warn("high-res CPU sampler unavailable", "error", err)
		return nil, err
	}

	h := &HighResCPU{
		buf:    make([]CPUSample, highResCapacity),
		cap:    highResCapacity,
		stopCh: make(chan struct{}),
	}
	h.push(CPUSample{Timestamp: time.Now().UTC(), Times: times})

	go h.loop(logger)
	logger.Info("high-res CPU sampler started",
		"interval", highResInterval.String(),
		"window", highResWindow.String(),
	)
	return h, nil
}

func (h *HighResCPU) loop(logger *slog.Logger) {
	ticker := time.NewTicker(highResInterval)
	defer ticker.Stop()
	for {
		select {
		case <-h.stopCh:
			return
		case <-ticker.C:
			times, err := cpu.Times(true)
			if err != nil {
				logger.Debug("high-res CPU sample failed", "error", err)
				continue
			}
			h.push(CPUSample{Timestamp: time.Now().UTC(), Times: times})
		}
	}
}
