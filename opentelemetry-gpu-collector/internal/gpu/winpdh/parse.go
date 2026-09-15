package winpdh

import (
	"fmt"
	"strconv"
	"strings"
)

// Instance fields parsed from a GPU PDH counter instance name.
// Example: "pid_1234_luid_0x00000000_0x00005678_phys_0_eng_0_engtype_3D"
type Instance struct {
	PID     int32
	LUIDKey string // "0xHHHHHHHH_0xLLLLLLLL"
	Phys    string
	Eng     string
	EngType string
}

// ParseInstance parses a Windows GPU Engine / GPU Process Memory instance name.
func ParseInstance(s string) Instance {
	parts := strings.Split(s, "_")
	var inst Instance
	for i, part := range parts {
		switch strings.ToLower(part) {
		case "pid":
			if i+1 < len(parts) {
				if v, err := strconv.ParseInt(parts[i+1], 10, 32); err == nil {
					inst.PID = int32(v)
				}
			}
		case "luid":
			if i+2 < len(parts) {
				inst.LUIDKey = fmt.Sprintf("%s_%s", parts[i+1], parts[i+2])
			}
		case "phys":
			if i+1 < len(parts) {
				inst.Phys = parts[i+1]
			}
		case "eng":
			if i+1 < len(parts) {
				inst.Eng = parts[i+1]
			}
		case "engtype":
			if i+1 < len(parts) {
				inst.EngType = parts[i+1]
			}
		}
	}
	return inst
}

// NormalizeEngType maps PDH engtype strings to coarse categories.
func NormalizeEngType(engtype string) string {
	e := strings.ToLower(engtype)
	switch {
	case strings.Contains(e, "copy"):
		return "copy"
	case strings.Contains(e, "decode") || strings.Contains(e, "videodecode"):
		return "decode"
	case strings.Contains(e, "encode") || strings.Contains(e, "videoencode") || strings.Contains(e, "encode"):
		return "encode"
	case strings.Contains(e, "compute"):
		return "compute"
	case e == "3d" || strings.Contains(e, "3d") || strings.Contains(e, "render") || strings.Contains(e, "graphics"):
		return "3d"
	default:
		return e
	}
}

// IsPrimaryCompute returns true for engines that should feed process.gpu.utilization.
func IsPrimaryCompute(engtype string) bool {
	n := NormalizeEngType(engtype)
	return n == "3d" || n == "compute"
}
