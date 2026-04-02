//go:build !linux

package nvidia

import (
	"fmt"
	"log/slog"

	"github.com/openlit/openlit/openlit-collector/internal/gpu"
)

// Device is a stub for non-Linux platforms.
type Device struct {
	info gpu.DeviceInfo
}

func (d *Device) Info() gpu.DeviceInfo        { return d.info }
func (d *Device) Collect() (*gpu.Snapshot, error) { return nil, fmt.Errorf("not supported on this OS") }
func (d *Device) Close()                       {}

func DiscoverDevices(_ *slog.Logger) ([]*Device, error) {
	return nil, fmt.Errorf("NVIDIA GPU support requires Linux")
}

func ShutdownNVML() {}
