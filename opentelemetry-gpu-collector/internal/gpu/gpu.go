package gpu

import "time"

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
	// CoreCount is the NVML CUDA core count when known (NVIDIA). Used by the
	// eBPF stream-sync occupancy model for process.gpu.core.usage normalization.
	CoreCount int

	// MIG identity (NVIDIA only). Empty when not a MIG instance.
	IsMIG          bool
	ParentUUID     string // physical GPU UUID when IsMIG
	MIGDeviceID    string // MIG UUID
	MIGInstanceID  int    // GPU instance id; -1 if unknown
	MIGProfileName string
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

	// PCIe throughput (bytes/sec). Soft-nil when unsupported.
	PCIeRxBytesPerSec *float64
	PCIeTxBytesPerSec *float64

	// Interconnect (NVLink / XGMI / Xe-Link) aggregate throughput.
	InterconnectRxBytesPerSec *float64
	InterconnectTxBytesPerSec *float64
	InterconnectType          string // nvlink | xgmi | other; empty if unknown

	// ThrottleReasons is a stable string label (e.g. "sw_thermal,hw_thermal") when known.
	ThrottleReasons *string
	// Throttled is 1 when any throttle reason is active, 0 when explicitly not.
	Throttled *float64

	// XID / RAS critical error cumulative counters when available.
	XIDErrors *int64
	RASUE     *int64 // uncorrectable RAS
	RASCE     *int64 // correctable RAS
}

// ProcessUsage holds per-process GPU memory and utilization for one device.
// Nil pointer fields indicate the metric is unavailable for this process.
type ProcessUsage struct {
	PID            int32
	ExecutableName string
	MemoryBytes    *int64
	Utilization    *float64 // 0..1 primary compute/render util
	EncoderUtil    *float64
	DecoderUtil    *float64

	// OS process metadata (filled by export enrichment; backends may leave empty).
	CommandLine string
	UserID      string
	Username    string
	StartTime   time.Time // zero if unknown
	State       string    // running, sleeping, zombie, stopped, dead, unknown
	ContainerID string

	// Workload classification from cmdline/exe (export layer).
	WorkloadKind      string // llm_inference | llm_training | other
	WorkloadFramework string // vllm | ollama | ...
}

// Device is the interface that all vendor GPU backends implement.
type Device interface {
	Info() DeviceInfo
	Collect() (*Snapshot, error)
	// CollectProcesses returns processes currently using this GPU.
	// Returns an empty slice (not an error) when unsupported or none are found.
	CollectProcesses() ([]ProcessUsage, error)
	Close()
}
