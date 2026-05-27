//go:build !darwin && !linux

package otlp

import "fmt"

// readProcessNameAndPPIDOS is unimplemented on non-Unix platforms.
// The host-detection walk simply short-circuits, returning "" — the
// caller already treats process-tree walking as a best-effort fallback.
func readProcessNameAndPPIDOS(pid int) (string, int, error) {
	return "", 0, fmt.Errorf("process introspection unsupported on this platform")
}
