//go:build linux

package nic

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// sysfsRoot is overridable in tests.
var sysfsRoot = "/sys/class/net"

// listIfaces returns interface names under sysfs.
func listIfaces() ([]string, error) {
	entries, err := os.ReadDir(sysfsRoot)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || e.Type()&os.ModeSymlink != 0 {
			out = append(out, e.Name())
		}
	}
	return out, nil
}

// readSpeedBps reads /sys/class/net/<dev>/speed (Mb/s) and converts to By/s.
// Returns 0 when the file is missing, "-1", or unparseable (common for down links).
func readSpeedBps(ifname string) int64 {
	raw, err := os.ReadFile(filepath.Join(sysfsRoot, ifname, "speed"))
	if err != nil {
		return 0
	}
	s := strings.TrimSpace(string(raw))
	mbps, err := strconv.ParseInt(s, 10, 64)
	if err != nil || mbps <= 0 {
		return 0
	}
	// Mb/s → By/s: * 1e6 / 8
	return mbps * 1_000_000 / 8
}

// readOperstate returns true when operstate is "up".
func readOperstate(ifname string) bool {
	raw, err := os.ReadFile(filepath.Join(sysfsRoot, ifname, "operstate"))
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(raw)) == "up"
}

// readSysfsStat reads a single uint64 from statistics/<name>.
func readSysfsStat(ifname, name string) uint64 {
	raw, err := os.ReadFile(filepath.Join(sysfsRoot, ifname, "statistics", name))
	if err != nil {
		return 0
	}
	v, err := strconv.ParseUint(strings.TrimSpace(string(raw)), 10, 63)
	if err != nil {
		return 0
	}
	return v
}

// readSysfsStats fills basic rx/tx counters from /sys/class/net/*/statistics.
func readSysfsStats(snap *IfaceSnapshot) {
	snap.RxBytes = readSysfsStat(snap.Name, "rx_bytes")
	snap.TxBytes = readSysfsStat(snap.Name, "tx_bytes")
	snap.RxPackets = readSysfsStat(snap.Name, "rx_packets")
	snap.TxPackets = readSysfsStat(snap.Name, "tx_packets")
	snap.RxErrors = readSysfsStat(snap.Name, "rx_errors")
	snap.TxErrors = readSysfsStat(snap.Name, "tx_errors")
	snap.RxDropped = readSysfsStat(snap.Name, "rx_dropped")
	snap.TxDropped = readSysfsStat(snap.Name, "tx_dropped")
}
