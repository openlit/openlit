package profiler

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"go.uber.org/zap"
)

// AppleProfiler implements GPU profiling for Apple Silicon
type AppleProfiler struct {
	logger     *zap.Logger
	maxSamples int
}

// NewAppleProfiler creates a new Apple Silicon GPU profiler
func NewAppleProfiler(logger *zap.Logger, maxSamples int) *AppleProfiler {
	return &AppleProfiler{
		logger:     logger,
		maxSamples: maxSamples,
	}
}

// Init initializes the Apple Silicon profiler
func (p *AppleProfiler) Init() error {
	// Check if running on Apple Silicon
	cmd := exec.Command("sysctl", "-n", "machdep.cpu.brand_string")
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("failed to check CPU type: %w", err)
	}

	if !strings.Contains(strings.ToLower(string(output)), "apple") {
		return fmt.Errorf("not running on Apple Silicon")
	}

	return nil
}

// GetGPUCount returns the number of Apple Silicon GPUs
func (p *AppleProfiler) GetGPUCount() int {
	return 1 // Apple Silicon has one integrated GPU
}

// GetProfile gets the current GPU profile
func (p *AppleProfiler) GetProfile() (*Profile, error) {
	// Get GPU utilization using powermetrics
	cmd := exec.Command("powermetrics", "-s", "gpu_power", "-n", "1")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get GPU metrics: %w", err)
	}

	// Parse powermetrics output
	lines := strings.Split(string(output), "\n")
	metrics := make(map[string]float64)

	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		switch fields[0] {
		case "GPU":
			if len(fields) >= 3 {
				// Parse GPU utilization
				if util, err := strconv.ParseFloat(fields[2], 64); err == nil {
					metrics[MetricGPUUtilization] = util
				}
			}
		case "GPU_Package":
			if len(fields) >= 3 {
				// Parse GPU power
				if power, err := strconv.ParseFloat(fields[2], 64); err == nil {
					metrics[MetricGPUPowerUsage] = power
				}
			}
		}
	}

	// Get memory info using vm_stat
	cmd = exec.Command("vm_stat")
	output, err = cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get memory info: %w", err)
	}

	// Parse vm_stat output
	lines = strings.Split(string(output), "\n")
	var totalMemory, freeMemory uint64

	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		switch fields[0] {
		case "Pages":
			if len(fields) >= 2 {
				if pages, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
					totalMemory = pages * 4096 // Convert pages to bytes
				}
			}
		case "Pages":
			if len(fields) >= 2 {
				if pages, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
					freeMemory = pages * 4096 // Convert pages to bytes
				}
			}
		}
	}

	metrics[MetricGPUMemoryTotal] = float64(totalMemory)
	metrics[MetricGPUMemoryFree] = float64(freeMemory)
	metrics[MetricGPUMemoryUsed] = float64(totalMemory - freeMemory)

	return &Profile{
		GPUType:  "apple",
		GPUIndex: 0,
		Metrics:  metrics,
	}, nil
}

// Start starts the profiler
func (p *AppleProfiler) Start(ctx context.Context) error {
	return nil // No special start needed for Apple Silicon
}

// Stop stops the profiler
func (p *AppleProfiler) Stop() error {
	return nil // No special stop needed for Apple Silicon
} 