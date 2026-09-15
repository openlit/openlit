//go:build !linux

package hostmetrics

func readPagingCounters() (major, minor, pageIn, pageOut uint64, ok bool) {
	return 0, 0, 0, 0, false
}
