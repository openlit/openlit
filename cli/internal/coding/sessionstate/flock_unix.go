//go:build darwin || linux || freebsd || netbsd || openbsd

package sessionstate

import (
	"os"
	"path/filepath"
	"syscall"
)

// withFileLock — Unix implementation. See the godoc comment in
// sessionstate.go for the contract. Uses BSD flock so the lock is
// advisory and process-scoped; sufficient for the openlit hook
// pattern (one hook subprocess per agent event, never overlapping
// inside the same process).
func withFileLock(lockPath string, fn func()) {
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o700); err != nil {
		fn()
		return
	}
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		fn()
		return
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		fn()
		return
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	fn()
}
