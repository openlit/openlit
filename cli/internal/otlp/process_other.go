//go:build !darwin && !linux && !windows

package otlp

import "fmt"

// readProcessNameAndPPIDOS is unimplemented on exotic platforms (plan9,
// js/wasm, the various BSDs we don't ship binaries for, etc.). The host-
// detection walk simply short-circuits, returning "" — the caller already
// treats process-tree walking as a best-effort fallback. macOS, Linux,
// and Windows have proper implementations in their own _<os>.go files.
func readProcessNameAndPPIDOS(pid int) (string, int, error) {
	return "", 0, fmt.Errorf("process introspection unsupported on this platform")
}
