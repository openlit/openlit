//go:build linux

package amdsmi

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func readRAS(drmDevicePath string) (ce, ue *int64) {
	rasDir := filepath.Join(drmDevicePath, "ras")
	entries, err := os.ReadDir(rasDir)
	if err != nil {
		return nil, nil
	}
	var ceSum, ueSum int64
	var hasCE, hasUE bool
	for _, e := range entries {
		name := e.Name()
		data, err := os.ReadFile(filepath.Join(rasDir, name))
		if err != nil {
			continue
		}
		// Files often contain "ue: N\nce: M" or similar.
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(strings.ToLower(line))
			if strings.HasPrefix(line, "ue:") || strings.HasPrefix(line, "ue ") {
				if v, ok := parseTrailingInt(line); ok {
					ueSum += v
					hasUE = true
				}
			}
			if strings.HasPrefix(line, "ce:") || strings.HasPrefix(line, "ce ") {
				if v, ok := parseTrailingInt(line); ok {
					ceSum += v
					hasCE = true
				}
			}
		}
	}
	if hasCE {
		ce = &ceSum
	}
	if hasUE {
		ue = &ueSum
	}
	return ce, ue
}

func parseTrailingInt(line string) (int64, bool) {
	fields := strings.FieldsFunc(line, func(r rune) bool {
		return r == ':' || r == ' ' || r == '\t'
	})
	if len(fields) == 0 {
		return 0, false
	}
	v, err := strconv.ParseInt(fields[len(fields)-1], 10, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}
