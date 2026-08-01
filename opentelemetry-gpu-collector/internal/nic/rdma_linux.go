//go:build linux

package nic

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// readRDMACounters discovers InfiniBand counters under
// /sys/class/net/<dev>/device/infiniband/<ibdev>/ports/1/{counters,hw_counters}/
// and returns allowlisted values that exist.
func readRDMACounters(ifname string, allow map[string]struct{}) map[string]uint64 {
	ibRoot := filepath.Join(sysfsRoot, ifname, "device", "infiniband")
	ibDevs, err := os.ReadDir(ibRoot)
	if err != nil {
		return nil
	}
	out := make(map[string]uint64)
	for _, d := range ibDevs {
		base := filepath.Join(ibRoot, d.Name(), "ports", "1")
		readRDMADir(filepath.Join(base, "counters"), allow, out)
		readRDMADir(filepath.Join(base, "hw_counters"), allow, out)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func readRDMADir(dir string, allow map[string]struct{}, out map[string]uint64) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if _, ok := allow[toLowerASCII(name)]; !ok {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		v, err := strconv.ParseUint(strings.TrimSpace(string(raw)), 10, 64)
		if err != nil {
			continue
		}
		out[name] = v
	}
}
