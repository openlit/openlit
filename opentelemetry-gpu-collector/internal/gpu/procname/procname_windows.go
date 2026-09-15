//go:build windows

package procname

import (
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// ExecutableName returns the process image basename for pid on Windows.
func ExecutableName(pid int32) string {
	if pid <= 0 {
		return ""
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)

	var buf [windows.MAX_PATH]uint16
	size := uint32(len(buf))
	err = windows.QueryFullProcessImageName(h, 0, &buf[0], &size)
	if err != nil {
		return ""
	}
	full := windows.UTF16ToString(buf[:size])
	base := filepath.Base(full)
	if len(base) > 64 {
		base = base[:64]
	}
	return strings.TrimSpace(base)
}
