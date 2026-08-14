//go:build windows

package sessionstate

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

// withFileLock — Windows implementation. See the godoc comment in
// sessionstate.go for the contract. Uses LockFileEx with LOCKFILE_EXCLUSIVE_LOCK
// (no LOCKFILE_FAIL_IMMEDIATELY) so the call blocks until the lock is acquired,
// matching the Unix flock behaviour. The lock is process-scoped and released
// either explicitly via UnlockFileEx or implicitly when the handle is closed —
// either way, a crashed hook cannot orphan the lock.
//
// On any setup failure (mkdir, open, lock acquisition) we fall back to running
// fn unlocked rather than dropping the event entirely: telemetry must never
// fail closed on an OS-level hiccup. The worst case is a single last-write-wins
// collision on the session-state file, which the in-process diskMu still
// guards against within a single process.
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

	// LockFileEx locks a byte range; pass a max range so we cover the
	// whole (currently-empty) lock file regardless of any future writes.
	// An overlapped structure with zeroed offsets locks from byte 0.
	var ol windows.Overlapped
	const exclusive = windows.LOCKFILE_EXCLUSIVE_LOCK
	if err := windows.LockFileEx(windows.Handle(f.Fd()), exclusive, 0, 0xFFFFFFFF, 0xFFFFFFFF, &ol); err != nil {
		fn()
		return
	}
	defer windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 0xFFFFFFFF, 0xFFFFFFFF, &ol)
	fn()
}
