package profiler

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/NVIDIA/go-nvml/pkg/nvml"
	"go.uber.org/zap"
)

// NVIDIAProfiler implements the Profiler interface for NVIDIA GPUs
type NVIDIAProfiler struct {
	logger     *zap.Logger
	devices    []nvml.Device
	profiles   []*GPUProfile
	maxSamples int
	mu         sync.RWMutex
}

// NewNVIDIAProfiler creates a new NVIDIA GPU profiler
func NewNVIDIAProfiler(logger *zap.Logger, maxSamples int) *NVIDIAProfiler {
	return &NVIDIAProfiler{
		logger:     logger,
		maxSamples: maxSamples,
		profiles:   make([]*GPUProfile, 0, maxSamples),
	}
}

// Init initializes the NVIDIA profiler
func (p *NVIDIAProfiler) Init() error {
	if err := nvml.Init(); err != nil {
		return fmt.Errorf("failed to initialize NVML: %w", err)
	}

	count, err := nvml.DeviceGetCount()
	if err != nil {
		return fmt.Errorf("failed to get device count: %w", err)
	}

	if count == 0 {
		p.logger.Warn("No NVIDIA GPUs found")
		return nil
	}

	p.devices = make([]nvml.Device, count)
	for i := 0; i < count; i++ {
		device, err := nvml.DeviceGetHandleByIndex(i)
		if err != nil {
			return fmt.Errorf("failed to get device handle for index %d: %w", i, err)
		}
		p.devices[i] = device
	}

	return nil
}

// Start starts the NVIDIA profiler
func (p *NVIDIAProfiler) Start(ctx context.Context) error {
	if len(p.devices) == 0 {
		return nil
	}

	// Enable profiling for each device
	for _, device := range p.devices {
		if err := device.SetComputeMode(nvml.COMPUTEMODE_DEFAULT); err != nil {
			p.logger.Warn("Failed to set compute mode", zap.Error(err))
		}
	}

	return nil
}

// Stop stops the NVIDIA profiler
func (p *NVIDIAProfiler) Stop() error {
	if len(p.devices) == 0 {
		return nil
	}

	// Cleanup NVML
	if err := nvml.Shutdown(); err != nil {
		return fmt.Errorf("failed to shutdown NVML: %w", err)
	}

	return nil
}

// GetProfile gets the latest GPU profile
func (p *NVIDIAProfiler) GetProfile() (*GPUProfile, error) {
	if len(p.devices) == 0 {
		return nil, nil
	}

	profile := &GPUProfile{
		Timestamp:        time.Now(),
		GPUType:          "nvidia",
		Metrics:          make(map[string]float64),
		ProfilingMetrics: make(map[string]interface{}),
	}

	// Collect metrics for each device
	for i, device := range p.devices {
		// Get utilization rates
		utilization, err := device.GetUtilizationRates()
		if err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUUtilization, i)] = float64(utilization.Gpu)
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUMemoryUtil, i)] = float64(utilization.Memory)
		}

		// Get temperature
		if temp, err := device.GetTemperature(nvml.TEMPERATURE_GPU); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUTemperature, i)] = float64(temp)
		}

		// Get memory info
		if memInfo, err := device.GetMemoryInfo(); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUMemoryTotal, i)] = float64(memInfo.Total)
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUMemoryUsed, i)] = float64(memInfo.Used)
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUMemoryFree, i)] = float64(memInfo.Free)
		}

		// Get power usage
		if power, err := device.GetPowerUsage(); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUPowerUsage, i)] = float64(power) / 1000.0 // Convert to watts
		}

		// Get power limit
		if powerLimit, err := device.GetEnforcedPowerLimit(); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUPowerLimit, i)] = float64(powerLimit) / 1000.0 // Convert to watts
		}

		// Get encoder/decoder utilization
		if encUtil, err := device.GetEncoderUtilization(); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUEncoderUtil, i)] = float64(encUtil.Utilization)
		}
		if decUtil, err := device.GetDecoderUtilization(); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUDecoderUtil, i)] = float64(decUtil.Utilization)
		}

		// Get compute mode
		if computeMode, err := device.GetComputeMode(); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUComputeMode, i)] = float64(computeMode)
		}

		// Get fan speed
		if fanSpeed, err := device.GetFanSpeed(); err == nil {
			profile.Metrics[fmt.Sprintf("%s.%d", MetricGPUFanSpeed, i)] = float64(fanSpeed)
		}

		// Get profiling metrics if available
		if pciInfo, err := device.GetPciInfo(); err == nil {
			profile.ProfilingMetrics[fmt.Sprintf("pci.bus_id.%d", i)] = pciInfo.BusId
		}

		// Get GPU name
		if name, err := device.GetName(); err == nil {
			profile.ProfilingMetrics[fmt.Sprintf("gpu.name.%d", i)] = name
		}

		// Get GPU UUID
		if uuid, err := device.GetUUID(); err == nil {
			profile.ProfilingMetrics[fmt.Sprintf("gpu.uuid.%d", i)] = uuid
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
func (p *NVIDIAProfiler) GetGPUType() string {
	return "nvidia"
}

// GetGPUCount returns the number of GPUs
func (p *NVIDIAProfiler) GetGPUCount() int {
	return len(p.devices)
} 