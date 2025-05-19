package profiler

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/ROCmSoftwarePlatform/amdsmi"
	"go.uber.org/zap"
)

// AMDProfiler implements the Profiler interface for AMD GPUs
type AMDProfiler struct {
	logger     *zap.Logger
	devices    []amdsmi.DeviceHandle
	profiles   []*GPUProfile
	maxSamples int
	mu         sync.RWMutex
}

// NewAMDProfiler creates a new AMD GPU profiler
func NewAMDProfiler(logger *zap.Logger, maxSamples int) *AMDProfiler {
	return &AMDProfiler{
		logger:     logger,
		maxSamples: maxSamples,
		profiles:   make([]*GPUProfile, 0, maxSamples),
	}
}

// Init initializes the AMD profiler
func (p *AMDProfiler) Init() error {
	if err := amdsmi.Init(); err != nil {
		return fmt.Errorf("failed to initialize AMDSMI: %w", err)
	}

	devices, err := amdsmi.GetDeviceHandles()
	if err != nil {
		return fmt.Errorf("failed to get device handles: %w", err)
	}

	if len(devices) == 0 {
		p.logger.Warn("No AMD GPUs found")
		return nil
	}

	p.devices = devices
	return nil
}

// Start starts the AMD profiler
func (p *AMDProfiler) Start(ctx context.Context) error {
	if len(p.devices) == 0 {
		return nil
	}

	// Enable profiling for each device
	for _, device := range p.devices {
		// Set compute mode to default
		if err := amdsmi.SetComputeMode(device, amdsmi.COMPUTE_MODE_DEFAULT); err != nil {
			p.logger.Warn("Failed to set compute mode", zap.Error(err))
		}
	}

	return nil
}

// Stop stops the AMD profiler
func (p *AMDProfiler) Stop() error {
	if len(p.devices) == 0 {
		return nil
	}

	// Cleanup AMDSMI
	if err := amdsmi.Shutdown(); err != nil {
		return fmt.Errorf("failed to shutdown AMDSMI: %w", err)
	}

	return nil
}

// GetProfile gets the latest GPU profile
func (p *AMDProfiler) GetProfile() (*GPUProfile, error) {
	if len(p.devices) == 0 {
		return nil, nil
	}

	profile := &GPUProfile{
		Timestamp:        time.Now(),
		GPUType:          "amd",
		Metrics:          make(map[string]float64),
		ProfilingMetrics: make(map[string]interface{}),
	}

	// Collect metrics for each device
	for i, device := range p.devices {
		// Get utilization
		if util, err := amdsmi.GetUtilizationCount(device, amdsmi.COARSE_GRAIN_GFX_ACTIVITY); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUUtilization, i)] = float64(util)
		}

		// Get temperature
		if temp, err := amdsmi.GetTemperature(device, amdsmi.TEMPERATURE_TYPE_EDGE); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUTemperature, i)] = float64(temp)
		}

		// Get memory info
		if memInfo, err := amdsmi.GetMemoryInfo(device); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUMemoryTotal, i)] = float64(memInfo.Total)
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUMemoryUsed, i)] = float64(memInfo.Used)
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUMemoryFree, i)] = float64(memInfo.Free)
		}

		// Get power info
		if powerInfo, err := amdsmi.GetPowerInfo(device); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUPowerUsage, i)] = float64(powerInfo.AverageSocketPower)
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUPowerLimit, i)] = float64(powerInfo.PowerLimit)
		}

		// Get fan speed
		if fanSpeed, err := amdsmi.GetFanSpeed(device, 0); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUFanSpeed, i)] = float64(fanSpeed)
		}

		// Get profiling metrics
		if pciInfo, err := amdsmi.GetPCIInfo(device); err == nil {
			profile.ProfilingMetrics[fmt.Sprintf("pci.bus_id.%d", i)] = pciInfo.BusID
		}

		// Get GPU name
		if name, err := amdsmi.GetDeviceName(device); err == nil {
			profile.ProfilingMetrics[fmt.Sprintf("gpu.name.%d", i)] = name
		}

		// Get GPU UUID
		if uuid, err := amdsmi.GetUUID(device); err == nil {
			profile.ProfilingMetrics[fmt.Sprintf("gpu.uuid.%d", i)] = uuid
		}

		// Get compute mode
		if computeMode, err := amdsmi.GetComputeMode(device); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUComputeMode, i)] = float64(computeMode)
		}
	}

	// Store the profile
	p.mu.Lock()
	p.profiles = append(p.profiles, profile)
	if len(p.profiles) > p.maxSamples {
		p.profiles = p.profiles[1:]
	}
	p.mu.Unlock()

	return profile, nil
}

// GetGPUType returns the GPU type
func (p *AMDProfiler) GetGPUType() string {
	return "amd"
}

// GetGPUCount returns the number of GPUs
func (p *AMDProfiler) GetGPUCount() int {
	return len(p.devices)
} 