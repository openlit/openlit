//go:build windows

package otlp

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// readProcessNameAndPPIDOS — Windows implementation. Walks the
// Toolhelp32 snapshot once to find the matching pid (cheap; the
// snapshot is in-memory and the OS already has the data ready). Then
// opens that process with PROCESS_QUERY_LIMITED_INFORMATION (the
// minimal right that works for non-elevated callers across all
// supported Windows versions) and reads the full executable path. We
// fall back to the snapshot's ExeFile basename if
// QueryFullProcessImageName fails — protected system processes deny
// PROCESS_QUERY_LIMITED_INFORMATION on hardened hosts but the snapshot
// is always readable.
//
// Why Toolhelp and not psapi.EnumProcesses? Toolhelp returns ppid
// directly in the same snapshot pass; EnumProcesses doesn't, and we'd
// have to make a second OpenProcess call per pid anyway. Toolhelp is
// the cheaper single-pass path.
func readProcessNameAndPPIDOS(pid int) (string, int, error) {
	if pid <= 0 {
		return "", 0, fmt.Errorf("invalid pid %d", pid)
	}
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return "", 0, fmt.Errorf("CreateToolhelp32Snapshot: %w", err)
	}
	defer windows.CloseHandle(snap)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return "", 0, fmt.Errorf("Process32First: %w", err)
	}
	for {
		if int(entry.ProcessID) == pid {
			ppid := int(entry.ParentProcessID)
			if full, ferr := queryFullImageName(entry.ProcessID); ferr == nil && full != "" {
				return full, ppid, nil
			}
			// Fallback: snapshot basename (e.g. "cursor.exe").
			return windows.UTF16ToString(entry.ExeFile[:]), ppid, nil
		}
		if err := windows.Process32Next(snap, &entry); err != nil {
			break
		}
	}
	return "", 0, fmt.Errorf("no process %d", pid)
}

// queryFullImageName resolves a pid's full executable path via the
// QueryFullProcessImageNameW Win32 API. Returns "" + error if the
// process is gone or denies the open.
func queryFullImageName(pid uint32) (string, error) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, windows.MAX_PATH)
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err != nil {
		return "", err
	}
	return windows.UTF16ToString(buf[:size]), nil
}
