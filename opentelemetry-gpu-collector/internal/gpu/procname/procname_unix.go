//go:build !windows

package procname

import (
	"os"
	"strconv"
	"strings"
)

// ExecutableName returns a short process name for pid from /proc.
// Prefer /proc/<pid>/comm; fall back to a truncated cmdline basename.
// Returns "" if the process is gone or unreadable (no panic, no error).
func ExecutableName(pid int32) string {
	if pid <= 0 {
		return ""
	}
	base := "/proc/" + strconv.FormatInt(int64(pid), 10)

	if data, err := os.ReadFile(base + "/comm"); err == nil {
		name := strings.TrimSpace(string(data))
		if name != "" {
			return name
		}
	}

	data, err := os.ReadFile(base + "/cmdline")
	if err != nil || len(data) == 0 {
		return ""
	}
	arg0 := string(data)
	if i := strings.IndexByte(arg0, 0); i >= 0 {
		arg0 = arg0[:i]
	}
	arg0 = strings.TrimSpace(arg0)
	if arg0 == "" {
		return ""
	}
	if i := strings.LastIndex(arg0, "/"); i >= 0 && i+1 < len(arg0) {
		arg0 = arg0[i+1:]
	}
	if len(arg0) > 64 {
		arg0 = arg0[:64]
	}
	return arg0
}
