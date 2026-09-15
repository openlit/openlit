//go:build !linux

package cudaoccupancy

import "time"

// monotonicNowNs is a wall-clock fallback for non-Linux unit tests.
// Production occupancy runs only with Linux eBPF; tests inject nowFn.
func monotonicNowNs() uint64 {
	return uint64(time.Now().UnixNano())
}
