//go:build !linux && !windows

package procinfo

// lookup on platforms without /proc or Windows process APIs (e.g. macOS).
func lookup(pid int32) Info {
	_ = pid
	return Info{State: "unknown"}
}
