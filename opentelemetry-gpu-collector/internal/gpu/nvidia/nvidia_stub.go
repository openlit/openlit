//go:build !(linux && (amd64 || arm64) && cgo)

package nvidia

import (
	"fmt"
	"log/slog"
	"runtime"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

// Device is a stub for platforms/builds where NVML is unavailable
// (non-Linux, unsupported arch, or CGO disabled).
type Device struct {
	info gpu.DeviceInfo
}

func (d *Device) Info() gpu.DeviceInfo            { return d.info }
func (d *Device) Collect() (*gpu.Snapshot, error) { return nil, errUnsupported() }
func (d *Device) Close()                          {}

func DiscoverDevices(_ *slog.Logger) ([]*Device, error) {
	return nil, errUnsupported()
}

// InitNVML is a no-op on unsupported builds; included so callers don't need
// build tags to invoke it.
func InitNVML() error { return errUnsupported() }

func ShutdownNVML() {}

func errUnsupported() error {
	return fmt.Errorf("NVIDIA NVML support requires linux/amd64 or linux/arm64 with cgo enabled (current: %s/%s)", runtime.GOOS, runtime.GOARCH)
}
