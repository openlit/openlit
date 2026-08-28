package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"sync"
	"syscall"
	"time"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/control"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/cpupmu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/cudaspans"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/discovery"
	gpuebpf "github.com/openlit/openlit/opentelemetry-gpu-collector/internal/ebpf"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/export"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/amd"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/dcgm"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/intel"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/nvidia"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/rdc"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/hostmetrics"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/intelpt"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/kineto"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/kvm"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/nic"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/tpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/version"
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
	if cfg.ModeInvalid {
		logger.Warn("unknown OTEL_GPU_COLLECTOR_MODE; falling back to all",
			"requested", os.Getenv("OTEL_GPU_COLLECTOR_MODE"),
			"mode", cfg.CollectorMode,
		)
	}
	logger.Info("starting openlit gpu metrics agent",
		"distro", version.DistroName,
		"version", version.Version,
		"environment", cfg.Environment,
		"interval", cfg.CollectionInterval,
		"mode", cfg.CollectorMode,
		"features", cfg.FeatureSummary(),
	)
	if cfg.ServiceName != "" {
		logger.Info("OTEL_SERVICE_NAME set (optional backend label)", "service.name", cfg.ServiceName)
	}
	cfg.LogModeWarnings(logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var report featureReport

	// --- OTel meter provider (always created, even with zero GPUs) ---
	meterSetup, err := export.NewMeterProvider(ctx, cfg, logger)
	if err != nil {
		return fmt.Errorf("creating meter provider: %w", err)
	}
	defer meterSetup.Shutdown()
	provider := meterSetup.Provider

	// --- Prometheus /metrics (optional) ---
	var promSrv *http.Server
	if cfg.PrometheusAddr != "" && meterSetup.PrometheusHandler != nil {
		mux := http.NewServeMux()
		mux.Handle("/metrics", meterSetup.PrometheusHandler)
		promSrv = &http.Server{
			Addr:              cfg.PrometheusAddr,
			Handler:           mux,
			ReadHeaderTimeout: 5 * time.Second,
		}
		go func() {
			logger.Info("prometheus HTTP listening", "addr", cfg.PrometheusAddr)
			if err := promSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				logger.Error("prometheus HTTP stopped", "error", err)
			}
		}()
	}

	// --- Host metrics (optional; default on for auto-collect) ---
	var sysColl *hostmetrics.SystemCollector
	var procColl *hostmetrics.ProcessCollector
	var irqColl *hostmetrics.InterruptsCollector
	var kvmColl *kvm.Collector
	if cfg.HostMetricsEnabled {
		var err error
		sysColl, err = hostmetrics.NewSystemCollector(provider, logger, cfg)
		if err != nil {
			report.fault(logger, config.FeatureHostMetrics, err.Error())
		}
		procColl, err = hostmetrics.NewProcessCollector(provider, logger)
		if err != nil {
			report.fault(logger, config.FeatureProcessMetrics, err.Error())
		}
	} else {
		logger.Info("host metrics disabled")
	}
	if cfg.InterruptsEnabled {
		var err error
		irqColl, err = hostmetrics.NewInterruptsCollector(provider, logger, cfg.InterruptsPerCPU)
		if err != nil {
			report.fault(logger, config.FeatureInterrupts, err.Error())
		}
	}
	if cfg.KVMEnabled {
		var err error
		kvmColl, err = kvm.NewCollector(provider, logger)
		if err != nil {
			report.fault(logger, config.FeatureKVM, err.Error())
		}
	}

	// --- Per-NIC / RDMA hardware metrics (optional) ---
	var nicColl *nic.Collector
	if cfg.NICEnabled || cfg.RDMAEnabled {
		var err error
		nicColl, err = nic.NewCollector(provider, cfg, logger)
		if err != nil {
			report.fault(logger, config.FeatureNIC, err.Error())
			nicColl = nil
		}
	}

	// --- CPU PMU (optional; missing CAP_PERFMON soft-fails inside the reader) ---
	var pmuColl *cpupmu.Collector
	if cfg.PMUEnabled {
		var err error
		pmuColl, err = cpupmu.NewCollector(provider, cfg, logger)
		if err != nil {
			report.fault(logger, config.FeaturePMU, err.Error())
			pmuColl = nil
		}
	}

	// --- TPU Prometheus scrape (optional; endpoint miss is scrape-time) ---
	var tpuColl *tpu.Collector
	if cfg.TPUEnabled {
		var err error
		tpuColl, err = tpu.NewCollector(provider, cfg, logger)
		if err != nil {
			report.fault(logger, config.FeatureTPU, err.Error())
			tpuColl = nil
		}
	}

	// --- High-res CPU ring (only when control RPC can expose it) ---
	var highResCPU *hostmetrics.HighResCPU
	if cfg.CPUHighRes {
		if cfg.ControlAddr != "" {
			hr, err := hostmetrics.NewHighResCPU(logger)
			if err != nil {
				report.unavailableFeature(logger, config.FeatureHighResCPU, err.Error())
			} else if hr == nil {
				report.unavailableFeature(logger, config.FeatureHighResCPU, "not supported on this platform")
			} else {
				highResCPU = hr
			}
		}
		// Empty control addr: LogModeWarnings already covers this.
	}

	// --- GPU device discovery with retry ---
	var (
		devicesMu  sync.Mutex
		devices    []gpu.Device
		collectors *gpuCollectors
	)
	setDevices := func(d []gpu.Device) {
		devicesMu.Lock()
		devices = d
		devicesMu.Unlock()
	}
	getDevices := func() []gpu.Device {
		devicesMu.Lock()
		defer devicesMu.Unlock()
		return devices
	}

	// GPU discovery: Linux (PCI/sysfs/NVML) and Windows (NVML/DXGI/PDH).
	// macOS and others keep host/process metrics only.
	gpuCapable := runtime.GOOS == "linux" || runtime.GOOS == "windows"

	if gpuCapable {
		discovered := tryDiscoverGPUs(logger)
		setDevices(discovered)
		if len(discovered) > 0 {
			collectors = setupCollectors(ctx, cfg, provider, discovered, logger, &report)
		} else {
			logger.Warn("no GPUs discovered at startup; will retry periodically")
		}
	} else {
		logger.Info("GPU monitoring not available on this platform", "os", runtime.GOOS)
	}

	// --- Kineto on-demand profiling (optional) ---
	var kinetoSrv *kineto.Server
	if cfg.KinetoEnabled {
		kinetoSrv = kineto.NewServer(cfg.KinetoTraceDir, cfg.KinetoSocket, logger)
		if err := kinetoSrv.Start(); err != nil {
			report.unavailableFeature(logger, config.FeatureKineto, err.Error())
			if cfg.ControlAddr != "" {
				logger.Info("kineto IPC unavailable; on-demand via control API still available")
			}
		}
	}

	// --- Control HTTP (optional; loopback by default) ---
	var controlSrv *http.Server
	if cfg.ControlAddr != "" {
		deps := control.Deps{
			Version:               version.Version,
			Kineto:                kinetoSrv,
			HighResCPU:            highResCPU,
			AllowRemote:           cfg.ControlAllowRemote,
			IntelPTMaxDurationMS:  cfg.IntelPTMaxDurationMS,
			IntelPTMaxBufferPages: cfg.IntelPTMaxBufferPages,
			IntelPTMaxCPUs:        cfg.IntelPTMaxCPUs,
			IntelPTOutputDir:      cfg.IntelPTOutputDir,
			GPUPIDs: func() []int32 {
				return kineto.CollectGPUPIDs(getDevices())
			},
			Meter: provider.Meter("openlit.collector.control"),
			DCGMPause: func(d time.Duration) error {
				if collectors != nil && collectors.dcgmMetrics != nil {
					return collectors.dcgmMetrics.PauseProfiling(d)
				}
				if collectors != nil && collectors.dcgmClient != nil {
					return collectors.dcgmClient.PauseProfiling(d)
				}
				return nil
			},
			DCGMResume: func() error {
				if collectors != nil && collectors.dcgmMetrics != nil {
					return collectors.dcgmMetrics.ResumeProfiling()
				}
				if collectors != nil && collectors.dcgmClient != nil {
					return collectors.dcgmClient.ResumeProfiling()
				}
				return nil
			},
		}
		if cfg.IntelPTEnabled {
			deps.IntelPT = intelpt.NewCapturer(logger)
			if !deps.IntelPT.Available() {
				report.unavailableFeature(logger, config.FeatureIntelPT, "need intel_pt PMU and perf in PATH")
			}
		}
		var err error
		controlSrv, err = control.Start(cfg.ControlAddr, cfg.ControlToken, deps, logger)
		if err != nil {
			report.fault(logger, config.FeatureControlHTTP, err.Error())
			controlSrv = nil
		}
	}

	avail := effectiveAvailability{
		gpus:            len(getDevices()),
		metrics:         collectors != nil && collectors.mc != nil,
		ebpf:            collectors != nil && collectors.ebpfTracer != nil,
		occupancy:       collectors != nil && collectors.occMetrics != nil,
		dcgm:            collectors != nil && collectors.dcgmMetrics != nil,
		dcgmPrefer:      collectors != nil && collectors.dcgmMetrics != nil && cfg.DCGMPrefer,
		rdc:             collectors != nil && collectors.rdcMetrics != nil,
		hostMetrics:     sysColl != nil,
		nic:             nicColl != nil,
		pmu:             pmuColl != nil,
		tpu:             tpuColl != nil,
		kvm:             kvmColl != nil,
		interrupts:      irqColl != nil,
		kineto:          kinetoSrv != nil,
		highResCPU:      highResCPU != nil,
		control:         controlSrv != nil,
		prometheus:      promSrv != nil,
		preferRequested: cfg.DCGMPrefer,
		unavailable:     failureNames(report.unavailable),
		faults:          failureNames(report.faults),
	}
	logEffectiveAvailability(logger, cfg, avail)

	if err := report.err(); err != nil {
		shutdownHTTP(controlSrv)
		shutdownHTTP(promSrv)
		if highResCPU != nil {
			highResCPU.Stop()
		}
		if kinetoSrv != nil {
			_ = kinetoSrv.Close()
		}
		if collectors != nil {
			collectors.close()
		}
		for _, d := range getDevices() {
			d.Close()
		}
		nvidia.ShutdownNVML()
		if sysColl != nil {
			sysColl.Close()
		}
		if procColl != nil {
			procColl.Close()
		}
		if irqColl != nil {
			irqColl.Close()
		}
		if kvmColl != nil {
			kvmColl.Close()
		}
		if nicColl != nil {
			nicColl.Close()
		}
		if pmuColl != nil {
			pmuColl.Close()
		}
		if tpuColl != nil {
			tpuColl.Close()
		}
		return err
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
			shutdownHTTP(controlSrv)
			shutdownHTTP(promSrv)
			if highResCPU != nil {
				highResCPU.Stop()
			}
			if kinetoSrv != nil {
				_ = kinetoSrv.Close()
			}
			if collectors != nil {
				collectors.close()
			}
			for _, d := range getDevices() {
				d.Close()
			}
			nvidia.ShutdownNVML()
			if sysColl != nil {
				sysColl.Close()
			}
			if procColl != nil {
				procColl.Close()
			}
			if irqColl != nil {
				irqColl.Close()
			}
			if kvmColl != nil {
				kvmColl.Close()
			}
			if nicColl != nil {
				nicColl.Close()
			}
			if pmuColl != nil {
				pmuColl.Close()
			}
			if tpuColl != nil {
				tpuColl.Close()
			}
			logger.Info("shutdown complete")
			return nil

		case <-retryTicker.C:
			if !gpuCapable || len(getDevices()) > 0 {
				continue
			}
			logger.Info("retrying GPU discovery...")
			discovered := tryDiscoverGPUs(logger)
			if len(discovered) > 0 {
				setDevices(discovered)
				var retryReport featureReport
				collectors = setupCollectors(ctx, cfg, provider, discovered, logger, &retryReport)
				if err := retryReport.err(); err != nil {
					logger.Error("GPU feature fault after discovery retry", "error", err)
					if collectors != nil {
						collectors.close()
						collectors = nil
					}
					for _, d := range discovered {
						d.Close()
					}
					setDevices(nil)
					return err
				}
				logger.Info("GPUs discovered on retry", "count", len(discovered),
					"unavailable", failureNames(retryReport.unavailable),
				)
			}
		}
	}
}

func shutdownHTTP(srv *http.Server) {
	if srv == nil {
		return
	}
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	_ = srv.Shutdown(shutdownCtx)
	shutdownCancel()
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

type effectiveAvailability struct {
	gpus            int
	metrics         bool
	ebpf            bool
	occupancy       bool
	dcgm            bool
	dcgmPrefer      bool
	rdc             bool
	hostMetrics     bool
	nic             bool
	pmu             bool
	tpu             bool
	kvm             bool
	interrupts      bool
	kineto          bool
	highResCPU      bool
	control         bool
	prometheus      bool
	preferRequested bool
	unavailable     []string
	faults          []string
}

// logEffectiveAvailability reports what actually started, not just config flags.
func logEffectiveAvailability(logger *slog.Logger, cfg *config.Config, a effectiveAvailability) {
	if logger == nil {
		return
	}
	logger.Info("effective feature availability",
		"mode", cfg.CollectorMode,
		"gpus", a.gpus,
		"vendor_metrics", a.metrics,
		"ebpf_attached", a.ebpf,
		"occupancy", a.occupancy,
		"dcgm_scraping", a.dcgm,
		"dcgm_prefer_active", a.dcgmPrefer,
		"dcgm_prefer_requested", a.preferRequested,
		"rdc_scraping", a.rdc,
		"host_metrics", a.hostMetrics,
		"nic", a.nic,
		"pmu", a.pmu,
		"tpu", a.tpu,
		"kvm", a.kvm,
		"interrupts", a.interrupts,
		"kineto", a.kineto,
		"cpu_highres", a.highResCPU,
		"control_http", a.control,
		"prometheus", a.prometheus,
		"unavailable", a.unavailable,
		"faults", a.faults,
	)
}

// gpuCollectors groups optional GPU metric backends started after discovery.
type gpuCollectors struct {
	mc          *export.MetricsCollector
	ebpfTracer  *gpuebpf.Tracer
	occMetrics  *export.OccupancyMetrics
	dcgmMetrics *export.DCGMMetrics
	dcgmClient  dcgm.Client
	rdcMetrics  *export.RDCMetrics
	rdcClient   rdc.Client
}

func (c *gpuCollectors) close() {
	if c == nil {
		return
	}
	if c.ebpfTracer != nil {
		c.ebpfTracer.Close()
	}
	if c.occMetrics != nil {
		c.occMetrics.Close()
	}
	if c.dcgmMetrics != nil {
		c.dcgmMetrics.Close()
	}
	if c.dcgmClient != nil {
		_ = c.dcgmClient.Close()
	}
	if c.rdcMetrics != nil {
		c.rdcMetrics.Close()
	}
	if c.rdcClient != nil {
		_ = c.rdcClient.Close()
	}
	if c.mc != nil {
		c.mc.Close()
	}
}

// setupCollectors initializes hardware metrics and optional eBPF / DCGM / RDC
// after GPUs have been successfully discovered.
func setupCollectors(
	ctx context.Context,
	cfg *config.Config,
	provider *sdkmetric.MeterProvider,
	devices []gpu.Device,
	logger *slog.Logger,
	report *featureReport,
) *gpuCollectors {
	out := &gpuCollectors{}

	mc, err := export.NewMetricsCollector(provider, devices, logger, cfg)
	if err != nil {
		if report != nil {
			report.fault(logger, config.FeatureVendorMetrics, err.Error())
		} else if logger != nil {
			logger.Error("failed to create metrics collector", "error", err)
		}
		return out
	}
	out.mc = mc

	if cfg.EBPFEnabled {
		resolver := cudaspans.NewDeviceResolver(devices)
		ebpfMetrics, err := export.NewEBPFMetrics(provider, resolver, logger)
		if err != nil {
			if report != nil {
				report.fault(logger, config.FeatureEBPF, err.Error())
			}
		} else {
			occ, err := export.NewOccupancyMetrics(provider, devices, resolver, logger)
			if err != nil {
				if report != nil {
					report.fault(logger, config.FeatureOccupancy, err.Error())
				}
			} else {
				out.occMetrics = occ
			}
			fanout := export.NewSpanFanout(ebpfMetrics, out.occMetrics)
			tracer, err := gpuebpf.NewTracer(logger, fanout.HandleEvent)
			if err != nil {
				if report != nil {
					if errors.Is(err, gpuebpf.ErrUnsupported) {
						report.unavailableFeature(logger, config.FeatureEBPF, err.Error())
					} else {
						report.fault(logger, config.FeatureEBPF, err.Error())
					}
				}
				if out.occMetrics != nil {
					out.occMetrics.Close()
					out.occMetrics = nil
				}
			} else {
				out.ebpfTracer = tracer
				go out.ebpfTracer.Run(ctx)
				logger.Info("eBPF CUDA tracing started (activity + stream-sync occupancy; libcudart + libcuda)")
			}
		}
	}

	if cfg.DCGMEnabled {
		client, err := dcgm.NewClient(cfg.DCGMLibPath, cfg.DCGMAddress, cfg.DCGMFields, cfg.DCGMInterval, logger)
		if err != nil {
			// NewClient is documented to never hard-error; a non-nil err is a contract violation.
			if report != nil {
				report.fault(logger, config.FeatureDCGM, err.Error())
			}
		} else {
			out.dcgmClient = client
			if client.Available() {
				dm, err := export.NewDCGMMetrics(provider, devices, client, cfg, logger, mc.PreferGate())
				if err != nil {
					if report != nil {
						report.fault(logger, config.FeatureDCGM, err.Error())
					}
				} else {
					out.dcgmMetrics = dm
					if cfg.DCGMPrefer {
						mc.SetSuppressVendorOverlap(true)
					}
					logger.Info("DCGM profiling metrics enabled",
						"interval", cfg.DCGMInterval.String(),
						"prefer", cfg.DCGMPrefer,
					)
				}
			} else if report != nil {
				report.unavailableFeature(logger, config.FeatureDCGM, "library/init unavailable")
				if cfg.DCGMPrefer {
					report.unavailableFeature(logger, config.FeatureDCGMPrefer, "DCGM inactive; NVML keeps overlapping series")
				}
			}
		}
	}

	if cfg.RDCEnabled {
		client, err := rdc.NewClient(cfg.RDCLibPath, logger)
		if err != nil {
			if report != nil {
				report.fault(logger, config.FeatureRDC, err.Error())
			}
		} else {
			out.rdcClient = client
			if client.Available() {
				rm, err := export.NewRDCMetrics(provider, devices, client, logger)
				if err != nil {
					if report != nil {
						report.fault(logger, config.FeatureRDC, err.Error())
					}
				} else {
					out.rdcMetrics = rm
					logger.Info("RDC profiling metrics enabled")
				}
			} else if report != nil {
				report.unavailableFeature(logger, config.FeatureRDC, "library/init unavailable")
			}
		}
	}

	return out
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

// discoverAllGPUsLinux finds GPUs on Linux. NVIDIA is tried via NVML even when
// PCI sysfs is incomplete (common in some containers). AMD/Intel use PCI addresses
// when available, with DRM/Level Zero fallbacks inside their discoverers.
func discoverAllGPUsLinux(logger *slog.Logger) ([]gpu.Device, error) {
	pciDevices, err := discovery.Discover(logger)
	if err != nil {
		logger.Debug("PCI discovery incomplete", "error", err)
		pciDevices = nil
	}

	var (
		allDevices []gpu.Device
		amdAddrs   []string
		intelAddrs []string
	)

	for _, d := range pciDevices {
		switch d.Vendor {
		case gpu.VendorAMD:
			amdAddrs = append(amdAddrs, d.Address)
		case gpu.VendorIntel:
			intelAddrs = append(intelAddrs, d.Address)
		}
	}

	idx := 0

	// Always attempt NVML — do not gate on PCI class scan.
	nvDevices, err := nvidia.DiscoverDevices(logger)
	if err != nil {
		logger.Warn("NVIDIA discovery failed", "error", err)
	} else {
		for _, d := range nvDevices {
			allDevices = append(allDevices, d)
			idx++
		}
	}

	amdDevices, err := amd.DiscoverDevices(amdAddrs, idx, logger)
	if err != nil {
		logger.Warn("AMD discovery failed", "error", err)
	} else {
		for _, d := range amdDevices {
			allDevices = append(allDevices, d)
			idx++
		}
	}

	intelDevices, err := intel.DiscoverDevices(intelAddrs, idx, logger)
	if err != nil {
		logger.Warn("Intel discovery failed", "error", err)
	} else {
		for _, d := range intelDevices {
			allDevices = append(allDevices, d)
		}
	}

	return allDevices, nil
}
