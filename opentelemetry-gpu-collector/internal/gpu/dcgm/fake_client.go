package dcgm

import (
	"sync"
	"time"
)

// FakeClient is a test double that returns canned samples.
type FakeClient struct {
	mu       sync.Mutex
	Samples  []Sample
	Err      error
	Avail    bool
	PauseErr error
	ResumeErr error
	Closed   bool
	pause    *pauseController
	Calls    struct {
		Sample int
		Pause  int
		Resume int
		Close  int
	}
}

// NewFakeClient returns an available FakeClient with optional initial samples.
func NewFakeClient(samples ...Sample) *FakeClient {
	return &FakeClient{
		Samples: samples,
		Avail:   true,
		pause:   newPauseController(),
	}
}

// Available reports whether the fake is marked available.
func (f *FakeClient) Available() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.Avail
}

// Sample returns the configured samples, filtering prof metrics while paused.
func (f *FakeClient) Sample() ([]Sample, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls.Sample++
	if f.Err != nil {
		return nil, f.Err
	}
	if !f.Avail {
		return nil, nil
	}
	paused := f.pause != nil && f.pause.Paused()
	out := make([]Sample, len(f.Samples))
	for i, s := range f.Samples {
		cp := Sample{
			DeviceID: s.DeviceID,
			GPUID:    s.GPUID,
			Blank:    s.Blank,
			Values:   make(map[string]float64, len(s.Values)),
		}
		for k, v := range s.Values {
			if paused && isProfMetricKey(k) {
				continue
			}
			cp.Values[k] = v
		}
		out[i] = cp
	}
	return out, nil
}

// PauseProfiling arms the pause timer.
func (f *FakeClient) PauseProfiling(duration time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls.Pause++
	if f.PauseErr != nil {
		return f.PauseErr
	}
	if f.pause == nil {
		f.pause = newPauseController()
	}
	f.pause.Pause(duration)
	return nil
}

// ResumeProfiling clears the pause.
func (f *FakeClient) ResumeProfiling() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls.Resume++
	if f.ResumeErr != nil {
		return f.ResumeErr
	}
	if f.pause != nil {
		f.pause.Resume()
	}
	return nil
}

// Close marks the fake closed.
func (f *FakeClient) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls.Close++
	f.Closed = true
	f.Avail = false
	return nil
}

// SetClock injects a clock for pause tests.
func (f *FakeClient) SetClock(now func() time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.pause == nil {
		f.pause = newPauseController()
	}
	f.pause.setNow(now)
}

func isProfMetricKey(key string) bool {
	switch key {
	case MetricEngineUtil, MetricSMUtil, MetricSMOccupancy,
		MetricPipeTensor, MetricMemBWUtil,
		MetricPipeFP64, MetricPipeFP32, MetricPipeFP16,
		MetricPCIeTxRate, MetricPCIeRxRate,
		MetricNVLinkTxRate, MetricNVLinkRxRate:
		return true
	default:
		return false
	}
}
