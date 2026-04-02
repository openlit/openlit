package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/openlit/openlit/openlit-collector/internal/config"
	"github.com/openlit/openlit/openlit-collector/internal/discovery"
	gpuebpf "github.com/openlit/openlit/openlit-collector/internal/ebpf"
	"github.com/openlit/openlit/openlit-collector/internal/export"
	"github.com/openlit/openlit/openlit-collector/internal/gpu"
	"github.com/openlit/openlit/openlit-collector/internal/gpu/amd"
	"github.com/openlit/openlit/openlit-collector/internal/gpu/intel"
	"github.com/openlit/openlit/openlit-collector/internal/gpu/nvidia"
	"github.com/openlit/openlit/openlit-collector/internal/hostmetrics"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	if err := run(logger); err != nil {
		logger.Error("fatal error", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg := config.Load()
	logger.Info("starting openlit-collector",
		"service", cfg.ServiceName,
		"environment", cfg.Environment,
		"interval", cfg.CollectionInterval,
		"ebpf_enabled", cfg.EBPFEnabled,
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// --- OTel meter provider (always created, even with zero GPUs) ---
	provider, shutdownProvider, err := export.NewMeterProvider(ctx, cfg, logger)
	if err != nil {
		return fmt.Errorf("creating meter provider: %w", err)
	}
	defer shutdownProvider()

	// --- Host metrics (always-on, works on all platforms) ---
	sysColl, err := hostmetrics.NewSystemCollector(provider, logger)
	if err != nil {
		logger.Warn("system metrics unavailable", "error", err)
	}

	procColl, err := hostmetrics.NewProcessCollector(provider, logger)
	if err != nil {
		logger.Warn("process metrics unavailable", "error", err)
	}

	// --- GPU device discovery with retry ---
	var devices []gpu.Device
	var mc *export.MetricsCollector
	var ebpfTracer *gpuebpf.Tracer

	// GPU discovery only makes sense on Linux (PCI sysfs, NVML, etc.)
	gpuCapable := runtime.GOOS == "linux"

	if gpuCapable {
		devices = tryDiscoverGPUs(logger)
		if len(devices) > 0 {
			mc, ebpfTracer = setupCollectors(ctx, cfg, provider, devices, logger)
		} else {
			logger.Warn("no GPUs discovered at startup; will retry periodically")
		}
	} else {
		logger.Info("GPU monitoring not available on this platform", "os", runtime.GOOS)
	}

	// --- Signal handling ---
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	retryTicker := time.NewTicker(30 * time.Second)
	defer retryTicker.Stop()

	for {
		select {
		case sig := <-sigCh:
			logger.Info("received signal, shutting down", "signal", sig.String())
			cancel()
			if ebpfTracer != nil {
				ebpfTracer.Close()
			}
			if mc != nil {
				mc.Close()
			}
			for _, d := range devices {
				d.Close()
			}
			if sysColl != nil {
				sysColl.Close()
			}
			if procColl != nil {
				procColl.Close()
			}
			logger.Info("shutdown complete")
			return nil

		case <-retryTicker.C:
			if !gpuCapable || len(devices) > 0 {
				continue
			}
			logger.Info("retrying GPU discovery...")
			devices = tryDiscoverGPUs(logger)
			if len(devices) > 0 {
				mc, ebpfTracer = setupCollectors(ctx, cfg, provider, devices, logger)
				logger.Info("GPUs discovered on retry", "count", len(devices))
			}
		}
	}
}

// tryDiscoverGPUs attempts GPU discovery, returning nil on failure instead of crashing.
func tryDiscoverGPUs(logger *slog.Logger) []gpu.Device {
	devices, err := discoverAllGPUs(logger)
	if err != nil {
		logger.Warn("GPU discovery error", "error", err)
		return nil
	}
	if len(devices) == 0 {
		logger.Warn("no GPUs found on this system")
		return nil
	}
	logger.Info("GPU discovery complete", "count", len(devices))
	return devices
}

// setupCollectors initializes hardware metrics and optional eBPF tracing
// after GPUs have been successfully discovered.
func setupCollectors(
	ctx context.Context,
	cfg *config.Config,
	provider *sdkmetric.MeterProvider,
	devices []gpu.Device,
	logger *slog.Logger,
) (*export.MetricsCollector, *gpuebpf.Tracer) {
	mc, err := export.NewMetricsCollector(provider, devices, logger)
	if err != nil {
		logger.Error("failed to create metrics collector", "error", err)
		return nil, nil
	}

	var ebpfTracer *gpuebpf.Tracer
	if cfg.EBPFEnabled {
		ebpfMetrics, err := export.NewEBPFMetrics(provider, logger)
		if err != nil {
			logger.Warn("failed to create eBPF metrics instruments", "error", err)
		} else {
			tracer, err := gpuebpf.NewTracer(logger, ebpfMetrics.HandleEvent)
			if err != nil {
				logger.Warn("eBPF CUDA tracing unavailable", "error", err)
			} else {
				ebpfTracer = tracer
				go ebpfTracer.Run(ctx)
				logger.Info("eBPF CUDA tracing started")
			}
		}
	}

	return mc, ebpfTracer
}

// discoverAllGPUs finds GPUs on the PCI bus and instantiates appropriate backends.
func discoverAllGPUs(logger *slog.Logger) ([]gpu.Device, error) {
	pciDevices, err := discovery.Discover(logger)
	if err != nil {
		return nil, err
	}

	var (
		allDevices  []gpu.Device
		nvidiaAddrs []string
		amdAddrs    []string
		intelAddrs  []string
	)

	for _, d := range pciDevices {
		switch d.Vendor {
		case gpu.VendorNVIDIA:
			nvidiaAddrs = append(nvidiaAddrs, d.Address)
		case gpu.VendorAMD:
			amdAddrs = append(amdAddrs, d.Address)
		case gpu.VendorIntel:
			intelAddrs = append(intelAddrs, d.Address)
		}
	}

	idx := 0

	// NVIDIA: use NVML for all NVIDIA GPUs at once
	if len(nvidiaAddrs) > 0 {
		nvDevices, err := nvidia.DiscoverDevices(logger)
		if err != nil {
			logger.Warn("NVIDIA discovery failed", "error", err)
		} else {
			for _, d := range nvDevices {
				allDevices = append(allDevices, d)
				idx++
			}
		}
	}

	// AMD: use sysfs for each AMD GPU
	if len(amdAddrs) > 0 {
		amdDevices, err := amd.DiscoverDevices(amdAddrs, idx, logger)
		if err != nil {
			logger.Warn("AMD discovery failed", "error", err)
		} else {
			for _, d := range amdDevices {
				allDevices = append(allDevices, d)
				idx++
			}
		}
	}

	// Intel: use sysfs for each Intel GPU
	if len(intelAddrs) > 0 {
		intelDevices, err := intel.DiscoverDevices(intelAddrs, idx, logger)
		if err != nil {
			logger.Warn("Intel discovery failed", "error", err)
		} else {
			for _, d := range intelDevices {
				allDevices = append(allDevices, d)
			}
		}
	}

	return allDevices, nil
}
