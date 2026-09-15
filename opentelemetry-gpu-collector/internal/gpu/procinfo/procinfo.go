// Package procinfo reads OS-level process metadata for GPU-attributed PIDs.
package procinfo

import "time"

// Info is OS process metadata used for GPU process attribution.
type Info struct {
	CommandLine string
	UserID      string
	Username    string
	StartTime   time.Time
	State       string // running, sleeping, zombie, stopped, dead, unknown
}

// Lookup returns process metadata for pid. Missing fields are left empty;
// State is "unknown" when the process cannot be inspected.
func Lookup(pid int32) Info {
	if pid <= 0 {
		return Info{State: "unknown"}
	}
	return lookup(pid)
}
