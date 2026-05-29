package gpu

// Vendor identifies the GPU manufacturer.
type Vendor string

const (
	VendorNVIDIA  Vendor = "nvidia"
	VendorAMD     Vendor = "amd"
	VendorIntel   Vendor = "intel"
	VendorUnknown Vendor = "unknown"
)

// DeviceInfo holds static identification data for a GPU.
type DeviceInfo struct {
	Vendor        Vendor
	Index         int
	Name          string
	UUID          string
	PCIAddress    string
	DriverVersion string
}

// Snapshot holds a point-in-time reading of all GPU metrics.
// Nil pointer fields indicate the metric is unavailable for this device.
type Snapshot struct {
	Utilization        *float64 // GPU compute busy (%)
	MemoryUtilization  *float64 // memory controller busy (%)
	EncoderUtilization *float64 // video encoder busy (%)
	DecoderUtilization *float64 // video decoder busy (%)

	TemperatureGPU    *float64 // die temperature (celsius)
	TemperatureMemory *float64 // memory temperature (celsius)
	FanSpeedRPM       *float64 // fan speed (RPM)

	MemoryTotalBytes *int64 // total VRAM (bytes)
	MemoryUsedBytes  *int64 // used VRAM (bytes)
	MemoryFreeBytes  *int64 // free VRAM (bytes)

	PowerDrawWatts  *float64 // current power draw (watts)
	PowerLimitWatts *float64 // power limit (watts)
	EnergyJoules    *float64 // cumulative energy consumed (joules)

	ClockGraphicsMHz *float64 // current graphics/SM clock (MHz)
	ClockMemoryMHz   *float64 // current memory clock (MHz)

	PCIeReplayErrors *int64 // cumulative PCIe replay counter
	ECCSingleBit     *int64 // correctable ECC errors
	ECCDoubleBit     *int64 // uncorrectable ECC errors
}

// Device is the interface that all vendor GPU backends implement.
type Device interface {
	Info() DeviceInfo
	Collect() (*Snapshot, error)
	Close()
}
