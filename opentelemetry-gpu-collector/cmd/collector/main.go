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

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/discovery"
	gpuebpf "github.com/openlit/openlit/opentelemetry-gpu-collector/internal/ebpf"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/export"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/amd"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/intel"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/nvidia"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/hostmetrics"
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
	logger.Info("starting opentelemetry-gpu-collector",
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
	var occMetrics *export.OccupancyMetrics

	// GPU discovery: Linux (PCI/sysfs/NVML) and Windows (NVML/DXGI/PDH).
	// macOS and others keep host/process metrics only.
	gpuCapable := runtime.GOOS == "linux" || runtime.GOOS == "windows"

	if gpuCapable {
		devices = tryDiscoverGPUs(logger)
		if len(devices) > 0 {
			mc, ebpfTracer, occMetrics = setupCollectors(ctx, cfg, provider, devices, logger)
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
			if occMetrics != nil {
				occMetrics.Close()
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
				mc, ebpfTracer, occMetrics = setupCollectors(ctx, cfg, provider, devices, logger)
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
) (*export.MetricsCollector, *gpuebpf.Tracer, *export.OccupancyMetrics) {
	mc, err := export.NewMetricsCollector(provider, devices, logger)
	if err != nil {
		logger.Error("failed to create metrics collector", "error", err)
		return nil, nil, nil
	}

	var ebpfTracer *gpuebpf.Tracer
	var occ *export.OccupancyMetrics
	if cfg.EBPFEnabled {
		ebpfMetrics, err := export.NewEBPFMetrics(provider, logger)
		if err != nil {
			logger.Warn("failed to create eBPF metrics instruments", "error", err)
		} else {
			var handlers []gpuebpf.EventHandler
			handlers = append(handlers, ebpfMetrics.HandleEvent)

			occ, err = export.NewOccupancyMetrics(provider, devices, logger)
			if err != nil {
				logger.Warn("failed to create occupancy metrics", "error", err)
				occ = nil
			} else {
				handlers = append(handlers, occ.HandleEvent)
			}

			tracer, err := gpuebpf.NewTracer(logger, gpuebpf.MultiplexHandlers(handlers...))
			if err != nil {
				logger.Warn("eBPF CUDA tracing unavailable", "error", err)
				if occ != nil {
					occ.Close()
					occ = nil
				}
			} else {
				ebpfTracer = tracer
				go ebpfTracer.Run(ctx)
				logger.Info("eBPF CUDA tracing started (activity + stream-sync occupancy)")
			}
		}
	}

	return mc, ebpfTracer, occ
}

// discoverAllGPUs finds GPUs and instantiates appropriate backends.
func discoverAllGPUs(logger *slog.Logger) ([]gpu.Device, error) {
	if runtime.GOOS == "windows" {
		return discoverAllGPUsWindows(logger)
	}
	return discoverAllGPUsLinux(logger)
}

// discoverAllGPUsWindows uses NVML + DXGI (no PCI sysfs).
func discoverAllGPUsWindows(logger *slog.Logger) ([]gpu.Device, error) {
	var allDevices []gpu.Device
	idx := 0

	nvDevices, err := nvidia.DiscoverDevices(logger)
	if err != nil {
		logger.Warn("NVIDIA discovery failed", "error", err)
	} else {
		for _, d := range nvDevices {
			allDevices = append(allDevices, d)
			idx++
		}
	}

	amdDevices, err := amd.DiscoverDevices(nil, idx, logger)
	if err != nil {
		logger.Warn("AMD discovery failed", "error", err)
	} else {
		for _, d := range amdDevices {
			allDevices = append(allDevices, d)
			idx++
		}
	}

	intelDevices, err := intel.DiscoverDevices(nil, idx, logger)
	if err != nil {
		logger.Warn("Intel discovery failed", "error", err)
	} else {
		for _, d := range intelDevices {
			allDevices = append(allDevices, d)
		}
	}

	return allDevices, nil
}

// discoverAllGPUsLinux finds GPUs on the PCI bus and instantiates backends.
func discoverAllGPUsLinux(logger *slog.Logger) ([]gpu.Device, error) {
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
