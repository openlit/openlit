package drmfdinfo

import "sync"

var (
	sharedMu      sync.Mutex
	sharedScanner *Scanner
)

// Shared returns a process-wide Scanner so AMD/Intel devices share delta state.
func Shared() *Scanner {
	sharedMu.Lock()
	defer sharedMu.Unlock()
	if sharedScanner == nil {
		sharedScanner = NewScanner()
	}
	return sharedScanner
}
