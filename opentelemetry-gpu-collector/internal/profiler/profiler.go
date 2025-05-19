package profiler

import (
	"context"
	"runtime"
	"time"
)

// Platform represents the operating system platform
type Platform string

const (
	PlatformLinux   Platform = "linux"
	PlatformWindows Platform = "windows"
	PlatformDarwin  Platform = "darwin"
)

// GPUType represents the GPU vendor
type GPUType string

const (
	GPUTypeNVIDIA GPUType = "nvidia"
	GPUTypeAMD    GPUType = "amd"
	GPUTypeIntel  GPUType = "intel"
	GPUTypeOther  GPUType = "other"
)

// ProcessInfo contains information about a process using the GPU
type ProcessInfo struct {
	PID         int
	Name        string
	MemoryUsage int64
	GPUUtil     float64
	StartTime   time.Time
}

// GPUProfile contains GPU metrics and information
type GPUProfile struct {
	GPUIndex         int
	GPUType          GPUType
	GPUName          string
	DriverVersion    string
	MemoryTotal      int64
	MemoryUsed       int64
	MemoryFree       int64
	Utilization      float64
	Temperature      float64
	PowerUsage       float64
	PowerLimit       float64
	FanSpeed         float64
	ComputeMode      string
	EncoderUtil      float64
	DecoderUtil      float64
	MemoryUtil       float64
	PowerEfficiency  float64
	ProcessInfo      *ProcessInfo
	Attributes       map[string]string
	Metrics          map[string]float64
	ProfilingMetrics map[string]interface{}
}

// Profiler defines the interface for GPU profiling
type Profiler interface {
	// Init initializes the profiler
	Init() error

	// Start begins profiling
	Start(ctx context.Context) error

	// Stop stops profiling
	Stop() error

	// GetProfile returns the current GPU profile
	GetProfile() (*GPUProfile, error)

	// GetGPUCount returns the number of GPUs
	GetGPUCount() int

	// GetGPUType returns the type of GPU
	GetGPUType() GPUType

	// GetPlatform returns the platform this profiler supports
	GetPlatform() Platform

	// IsAvailable checks if the profiler is available on the current platform
	IsAvailable() bool

	// GetProcessInfo returns information about processes using the GPU
	GetProcessInfo() ([]ProcessInfo, error)
}

// GetCurrentPlatform returns the current platform
func GetCurrentPlatform() Platform {
	switch runtime.GOOS {
	case "linux":
		return PlatformLinux
	case "windows":
		return PlatformWindows
	case "darwin":
		return PlatformDarwin
	default:
		return PlatformOther
	}
}

// IsPlatformSupported checks if a platform is supported
func IsPlatformSupported(platform Platform) bool {
	switch platform {
	case PlatformLinux:
		return true
	case PlatformWindows:
		return true
	case PlatformDarwin:
		return false // Limited support on macOS
	default:
		return false
	}
}

// GetSupportedGPUTypes returns the GPU types supported on the current platform
func GetSupportedGPUTypes() []GPUType {
	platform := GetCurrentPlatform()
	switch platform {
	case PlatformLinux:
		return []GPUType{GPUTypeNVIDIA, GPUTypeAMD, GPUTypeIntel}
	case PlatformWindows:
		return []GPUType{GPUTypeNVIDIA}
	case PlatformDarwin:
		return []GPUType{} // No native GPU monitoring on macOS
	default:
		return []GPUType{}
	}
}

// Common GPU metrics that should be collected
const (
	MetricGPUUtilization     = "gpu.utilization"
	MetricGPUTemperature     = "gpu.temperature"
	MetricGPUPowerUsage      = "gpu.power_usage"
	MetricGPUMemoryUsed      = "gpu.memory.used"
	MetricGPUMemoryTotal     = "gpu.memory.total"
	MetricGPUMemoryFree      = "gpu.memory.free"
	MetricGPUFanSpeed        = "gpu.fan_speed"
	MetricGPUComputeMode     = "gpu.compute_mode"
	MetricGPUEncoderUtil     = "gpu.encoder.utilization"
	MetricGPUDecoderUtil     = "gpu.decoder.utilization"
	MetricGPUMemoryUtil      = "gpu.memory.utilization"
	MetricGPUPowerLimit      = "gpu.power_limit"
	MetricGPUPowerDraw       = "gpu.power_draw"
	MetricGPUPowerEfficiency = "gpu.power_efficiency"
)

// Profiling specific metrics
const (
	MetricGPUProfilingKernelExecTime = "gpu.profiling.kernel_exec_time"
	MetricGPUProfilingMemoryOps      = "gpu.profiling.memory_ops"
	MetricGPUProfilingComputeOps     = "gpu.profiling.compute_ops"
	MetricGPUProfilingOccupancy      = "gpu.profiling.occupancy"
	MetricGPUProfilingSMUtilization  = "gpu.profiling.sm_utilization"
) 