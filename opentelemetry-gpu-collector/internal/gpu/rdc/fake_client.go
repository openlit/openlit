package rdc

import "sync"

// FakeClient is a test double that returns canned samples.
type FakeClient struct {
	mu      sync.Mutex
	Samples []Sample
	Err     error
	Avail   bool
	Closed  bool
	Calls   struct {
		Sample int
		Close  int
	}
}

// NewFakeClient returns an available FakeClient with optional initial samples.
func NewFakeClient(samples ...Sample) *FakeClient {
	return &FakeClient{
		Samples: samples,
		Avail:   true,
	}
}

// Available reports whether the fake is marked available.
func (f *FakeClient) Available() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.Avail
}

// Sample returns the configured samples.
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
	out := make([]Sample, len(f.Samples))
	for i, s := range f.Samples {
		cp := Sample{
			DeviceID:  s.DeviceID,
			GPUID:     s.GPUID,
			ParentID:  s.ParentID,
			Partition: s.Partition,
			Values:    make(map[string]float64, len(s.Values)),
		}
		for k, v := range s.Values {
			cp.Values[k] = v
		}
		out[i] = cp
	}
	return out, nil
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
