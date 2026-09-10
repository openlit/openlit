package cpupmu

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type uncoreDev struct {
	name    string
	path    string
	pmuType uint32
	cpumask string
}

func discoverUncoreIMCs(devicesRoot string) []uncoreDev {
	entries, err := os.ReadDir(devicesRoot)
	if err != nil {
		return nil
	}
	var out []uncoreDev
	for _, e := range entries {
		name := e.Name()
		if !(strings.HasPrefix(name, "uncore_imc") || strings.HasPrefix(name, "amd_umc")) {
			continue
		}
		if strings.Contains(name, "free_running") {
			continue
		}
		path := filepath.Join(devicesRoot, name)
		typB, err := os.ReadFile(filepath.Join(path, "type"))
		if err != nil {
			continue
		}
		typ, err := strconv.ParseUint(strings.TrimSpace(string(typB)), 10, 32)
		if err != nil {
			continue
		}
		maskB, _ := os.ReadFile(filepath.Join(path, "cpumask"))
		out = append(out, uncoreDev{
			name:    name,
			path:    path,
			pmuType: uint32(typ),
			cpumask: strings.TrimSpace(string(maskB)),
		})
	}
	return out
}

func readUncoreEventConfig(devPath, eventName string) (uint64, bool) {
	b, err := os.ReadFile(filepath.Join(devPath, "events", eventName))
	if err != nil {
		return 0, false
	}
	var event, umask uint64
	hasEvent := false
	for _, part := range strings.Split(strings.TrimSpace(string(b)), ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		v, err := strconv.ParseUint(strings.TrimSpace(kv[1]), 0, 64)
		if err != nil {
			continue
		}
		switch kv[0] {
		case "event":
			event = v
			hasEvent = true
		case "umask":
			umask = v
		}
	}
	if !hasEvent {
		return 0, false
	}
	return event | (umask << 8), true
}

func parseCPUMask(mask string) []int {
	mask = strings.TrimSpace(mask)
	if mask == "" {
		return nil
	}
	var out []int
	for _, part := range strings.Split(mask, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "-") {
			bounds := strings.SplitN(part, "-", 2)
			if len(bounds) != 2 {
				continue
			}
			lo, err1 := strconv.Atoi(bounds[0])
			hi, err2 := strconv.Atoi(bounds[1])
			if err1 != nil || err2 != nil || hi < lo {
				continue
			}
			for i := lo; i <= hi; i++ {
				out = append(out, i)
			}
			continue
		}
		n, err := strconv.Atoi(part)
		if err == nil {
			out = append(out, n)
		}
	}
	return out
}
