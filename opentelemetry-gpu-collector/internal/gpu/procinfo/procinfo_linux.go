//go:build linux

package procinfo

import (
	"os"
	"os/user"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

var (
	bootOnce   sync.Once
	bootTime   time.Time
	clkOnce    sync.Once
	clkTicks   int64 = 100
	userCache  sync.Map // string UID → string username
)

func lookup(pid int32) Info {
	info := Info{State: "unknown"}
	base := "/proc/" + strconv.FormatInt(int64(pid), 10)

	if data, err := os.ReadFile(base + "/cmdline"); err == nil && len(data) > 0 {
		info.CommandLine = formatCmdline(data)
	}

	if data, err := os.ReadFile(base + "/status"); err == nil {
		parseStatus(string(data), &info)
	}

	if data, err := os.ReadFile(base + "/stat"); err == nil {
		if st, ok := parseStartTime(string(data)); ok {
			info.StartTime = st
		}
	}

	if info.UserID != "" && info.Username == "" {
		info.Username = lookupUsername(info.UserID)
	}
	return info
}

func lookupUsername(uid string) string {
	if v, ok := userCache.Load(uid); ok {
		return v.(string)
	}
	u, err := user.LookupId(uid)
	if err != nil {
		userCache.Store(uid, "")
		return ""
	}
	userCache.Store(uid, u.Username)
	return u.Username
}

func formatCmdline(data []byte) string {
	// Avoid strings.Split allocation explosion for huge cmdline buffers.
	n := 0
	for i := 0; i < len(data); i++ {
		if data[i] == 0 {
			n++
		}
	}
	parts := make([]string, 0, n+1)
	start := 0
	for i := 0; i <= len(data); i++ {
		if i == len(data) || data[i] == 0 {
			if i > start {
				parts = append(parts, string(data[start:i]))
			}
			start = i + 1
		}
	}
	return strings.Join(parts, " ")
}

func parseStatus(content string, info *Info) {
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, "State:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				info.State = mapLinuxState(fields[1])
			}
			continue
		}
		if strings.HasPrefix(line, "Uid:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				info.UserID = fields[1]
			}
		}
	}
}

func mapLinuxState(code string) string {
	if code == "" {
		return "unknown"
	}
	switch code[0] {
	case 'R':
		return "running"
	case 'S', 'D', 'I':
		return "sleeping"
	case 'Z':
		return "zombie"
	case 'T', 't':
		return "stopped"
	case 'X', 'x':
		return "dead"
	default:
		return "unknown"
	}
}

func parseStartTime(stat string) (time.Time, bool) {
	i := strings.LastIndex(stat, ")")
	if i < 0 || i+2 >= len(stat) {
		return time.Time{}, false
	}
	fields := strings.Fields(stat[i+2:])
	if len(fields) < 20 {
		return time.Time{}, false
	}
	ticks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil {
		return time.Time{}, false
	}
	bt := systemBootTime()
	if bt.IsZero() {
		return time.Time{}, false
	}
	hz := clockTicks()
	sec := float64(ticks) / float64(hz)
	return bt.Add(time.Duration(sec * float64(time.Second))), true
}

func systemBootTime() time.Time {
	bootOnce.Do(func() {
		data, err := os.ReadFile("/proc/stat")
		if err != nil {
			return
		}
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "btime ") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					sec, err := strconv.ParseInt(fields[1], 10, 64)
					if err == nil {
						bootTime = time.Unix(sec, 0)
					}
				}
				return
			}
		}
	})
	return bootTime
}

func clockTicks() int64 {
	clkOnce.Do(func() {
		if hz, err := unix.Sysconf(unix.SC_CLK_TCK); err == nil && hz > 0 {
			clkTicks = hz
		}
	})
	return clkTicks
}
