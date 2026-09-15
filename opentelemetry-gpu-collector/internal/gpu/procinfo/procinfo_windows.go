//go:build windows

package procinfo

import (
	"os/user"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	stillActive              = 259
	processQueryLimitedInfo  = windows.PROCESS_QUERY_LIMITED_INFORMATION
	tokenQuery               = windows.TOKEN_QUERY
)

func lookup(pid int32) Info {
	info := Info{State: "unknown"}
	h, err := windows.OpenProcess(processQueryLimitedInfo|windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return info
	}
	defer windows.CloseHandle(h)

	var buf [windows.MAX_PATH * 4]uint16
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err == nil {
		info.CommandLine = windows.UTF16ToString(buf[:size])
	}

	// Create time via GetProcessTimes.
	var creation, exit, kernel, userFile windows.Filetime
	if err := windows.GetProcessTimes(h, &creation, &exit, &kernel, &userFile); err == nil {
		info.StartTime = time.Unix(0, creation.Nanoseconds())
	}

	// Exit code: STILL_ACTIVE means running; otherwise treat as dead/zombie-equivalent
	// for GPU attribution (process handle still visible to driver briefly).
	var code uint32
	if err := windows.GetExitCodeProcess(h, &code); err == nil {
		if code == stillActive {
			info.State = "running"
		} else {
			info.State = "zombie"
		}
	}

	// Owner SID → username.
	var token windows.Token
	if err := windows.OpenProcessToken(h, tokenQuery, &token); err == nil {
		defer token.Close()
		tokUser, err := token.GetTokenUser()
		if err == nil && tokUser != nil {
			sid := tokUser.User.Sid
			info.UserID = sid.String()
			account, domain, _, err := sid.LookupAccount("")
			if err == nil {
				if domain != "" {
					info.Username = domain + `\` + account
				} else {
					info.Username = account
				}
			} else if u, err := user.LookupId(info.UserID); err == nil {
				info.Username = u.Username
			}
		}
	}

	// Enrich cmdline via NtQueryInformationProcess ProcessCommandLineInformation when available.
	if cl := queryCommandLine(h); cl != "" {
		info.CommandLine = cl
	}

	return info
}

// PROCESSINFOCLASS 60 = ProcessCommandLineInformation (Win10+)
const processCommandLineInformation = 60

type unicodeString struct {
	Length        uint16
	MaximumLength uint16
	Buffer        *uint16
}

func queryCommandLine(h windows.Handle) string {
	ntdll := windows.NewLazySystemDLL("ntdll.dll")
	proc := ntdll.NewProc("NtQueryInformationProcess")
	if err := proc.Find(); err != nil {
		return ""
	}

	var retLen uint32
	// Size probe
	r, _, _ := proc.Call(
		uintptr(h),
		uintptr(processCommandLineInformation),
		0,
		0,
		uintptr(unsafe.Pointer(&retLen)),
	)
	if retLen == 0 {
		_ = r
		return ""
	}
	buf := make([]byte, retLen)
	r, _, _ = proc.Call(
		uintptr(h),
		uintptr(processCommandLineInformation),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(retLen),
		uintptr(unsafe.Pointer(&retLen)),
	)
	// STATUS_SUCCESS = 0
	if r != 0 {
		return ""
	}
	us := (*unicodeString)(unsafe.Pointer(&buf[0]))
	if us.Buffer == nil || us.Length == 0 {
		return ""
	}
	n := int(us.Length / 2)
	slice := unsafe.Slice(us.Buffer, n)
	return strings.TrimSpace(windows.UTF16ToString(slice))
}
