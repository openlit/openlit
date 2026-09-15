//go:build linux

package cudaoccupancy

import "golang.org/x/sys/unix"

// monotonicNowNs returns CLOCK_MONOTONIC nanoseconds, matching bpf_ktime_get_ns()
// (excludes suspend time). Must not use wall-clock UnixNano — that is a different
// domain and makes every occupancy interval clamp to empty.
func monotonicNowNs() uint64 {
	var ts unix.Timespec
	if err := unix.ClockGettime(unix.CLOCK_MONOTONIC, &ts); err != nil {
		return 0
	}
	return uint64(ts.Sec)*1e9 + uint64(ts.Nsec)
}
