package dcgm

import (
	"strconv"
	"strings"
)

// ParseFieldsCSV parses a comma-separated list of DCGM field IDs.
// Invalid tokens are skipped.
func ParseFieldsCSV(csv string) []uint16 {
	if strings.TrimSpace(csv) == "" {
		return nil
	}
	var out []uint16
	seen := make(map[uint16]struct{})
	for _, part := range strings.Split(csv, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		n, err := strconv.ParseUint(part, 10, 16)
		if err != nil {
			continue
		}
		id := uint16(n)
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// EnsureIdentityFields adds UUID (and keeps NAME if present) so DeviceID can be resolved.
func EnsureIdentityFields(fields []uint16) []uint16 {
	hasUUID := false
	for _, f := range fields {
		if f == FieldUUID {
			hasUUID = true
			break
		}
	}
	if hasUUID {
		return fields
	}
	out := make([]uint16, len(fields)+1)
	copy(out, fields)
	out[len(fields)] = FieldUUID
	return out
}

// SplitProfFields partitions field IDs into regular vs profiling (>=1001).
func SplitProfFields(fields []uint16) (regular, prof []uint16) {
	for _, f := range fields {
		if IsProfField(f) {
			prof = append(prof, f)
		} else {
			regular = append(regular, f)
		}
	}
	return regular, prof
}
