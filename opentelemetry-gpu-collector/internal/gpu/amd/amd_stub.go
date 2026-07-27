//go:build !linux && !windows

package amd

import (
	"fmt"
	"log/slog"
	"runtime"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

type Device struct {
	info gpu.DeviceInfo
}

func (d *Device) Info() gpu.DeviceInfo            { return d.info }
func (d *Device) Collect() (*gpu.Snapshot, error) { return nil, errUnsupported() }
func (d *Device) CollectProcesses() ([]gpu.ProcessUsage, error) {
	return nil, errUnsupported()
}
func (d *Device) Close() {}

func DiscoverDevices(_ []string, _ int, _ *slog.Logger) ([]*Device, error) {
	return nil, errUnsupported()
}

func errUnsupported() error {
	return fmt.Errorf("AMD GPU monitoring requires linux or windows (current: %s/%s)", runtime.GOOS, runtime.GOARCH)
}
