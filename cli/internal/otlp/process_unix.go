//go:build darwin || linux

package otlp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// psTimeout caps how long the macOS `ps` fallback may run. Host
// detection walks up to ~12 ancestors from a cold start (see the
// readProcessNameAndPPIDOS callers in exporter.go), so an unbounded
// `ps` invocation that hung even briefly could compound into a full
// stall of the 5s hook budget. 100ms is generous for a process that
// normally returns in single-digit ms.
const psTimeout = 100 * time.Millisecond

// readProcessNameAndPPIDOS returns the argv[0] and parent pid of `pid`.
// On Linux it reads /proc directly; on macOS it shells out to `ps`.
// Failures bubble up so the caller can short-circuit the host-detection
// walk — telemetry must never fail on a missing process.
func readProcessNameAndPPIDOS(pid int) (string, int, error) {
	if pid <= 0 {
		return "", 0, fmt.Errorf("invalid pid %d", pid)
	}
	// Linux: /proc is always cheaper and stable.
	if data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid)); err == nil {
		// /proc/PID/stat layout: pid (comm) state ppid …
		// `comm` is parenthesised and may contain spaces, so we
		// search for the FINAL ')' before extracting the rest.
		s := string(data)
		if end := strings.LastIndex(s, ")"); end > 0 {
			fields := strings.Fields(s[end+1:])
			if len(fields) >= 2 {
				ppid, perr := strconv.Atoi(fields[1])
				if perr == nil {
					if cmdline, cerr := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid)); cerr == nil {
						argv0 := string(cmdline)
						if idx := strings.IndexByte(argv0, 0); idx >= 0 {
							argv0 = argv0[:idx]
						}
						return argv0, ppid, nil
					}
				}
			}
		}
	}
	// macOS / fallback: `ps -o ppid=,command= -p <pid>` returns
	// "  <ppid> <full command line>" on one line. `command=` strips
	// the header. The CommandContext bound bails immediately if a
	// hung `ps` would otherwise dominate the hook budget.
	psCtx, cancel := context.WithTimeout(context.Background(), psTimeout)
	defer cancel()
	out, err := exec.CommandContext(psCtx, "ps", "-o", "ppid=,command=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return "", 0, err
	}
	line := strings.TrimSpace(string(out))
	if line == "" {
		return "", 0, fmt.Errorf("no process %d", pid)
	}
	// Split into ppid + command. The first whitespace-separated token
	// is the ppid; the remainder is argv[0] (possibly with args).
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return "", 0, fmt.Errorf("unparseable ps output for pid %d: %q", pid, line)
	}
	ppid, err := strconv.Atoi(fields[0])
	if err != nil {
		return "", 0, err
	}
	bin := strings.Join(fields[1:], " ")
	// argv[0] is the binary path before the first space — drop later
	// args so substring matching is reliable.
	if idx := strings.IndexByte(bin, ' '); idx > 0 {
		bin = bin[:idx]
	}
	return bin, ppid, nil
}
