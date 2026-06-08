package engine

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
	"github.com/openlit/openlit/openlit-controller/internal/scanner"
	"go.uber.org/zap"
)

// ExportConfig holds the OTLP export settings that can be updated at runtime
// from the Agents UI configuration editor.
type ExportConfig struct {
	OTLPEndpoint        string
	OTLPProtocol        string
	OTLPHeaders         map[string]string
	OTLPTracesEndpoint  string
	OTLPMetricsEndpoint string
	OTLPLogsEndpoint    string
}

// instrumentPattern represents a service pattern for OBI discovery.
type instrumentPattern struct {
	ServiceID      string
	ExePath        string
	CmdArgs        string
	TargetPIDs     []int
	ContainersOnly bool
	K8sNamespace   string
	K8sPodName     string
	K8sDeployment  string
	K8sDaemonSet   string
	K8sStatefulSet string
}

// Engine orchestrates the eBPF scanner and per-service OBI instrumentation.
type Engine struct {
	mu       sync.RWMutex
	cancel   context.CancelFunc
	appCtx   context.Context
	services map[string]*openlit.ServiceState
	logger   *zap.Logger
	running  bool

	scanner     *scanner.Scanner
	customHosts []string // user-configured custom LLM host specs ("host[:port]")
	obi         *OBIManager
	exportCfg   ExportConfig
	procRoot    string
	deployMode  config.DeployMode
	container   *ContainerEnricher
	environment string
	sdkVersion  string

	patterns map[string]instrumentPattern // serviceID -> pattern
}

const (
	CapabilityOBILLMObservability     = "obi_llm_observability"
	CapabilityPythonSDKKubernetesV1   = "python_sdk_injection_kubernetes_v1"
	CapabilityPythonSDKDockerV1       = "python_sdk_injection_docker_v1"
	CapabilityPythonSDKLinuxSystemdV1 = "python_sdk_injection_linux_systemd_v1"
	CapabilityPythonSDKLinuxBareV1    = "python_sdk_injection_linux_bare_v1"
	CapabilityLifecycleKubernetesV1   = "lifecycle_kubernetes_v1"
	CapabilityLifecycleDockerV1       = "lifecycle_docker_v1"
	CapabilityLifecycleLinuxSystemdV1 = "lifecycle_linux_systemd_v1"
	CapabilityLifecycleLinuxBareV1    = "lifecycle_linux_bare_v1"
)

// Lifecycle resource-attribute / annotation keys shared between the
// controller heartbeat and the dashboard rollup. Keep these constants in
// sync with the SQL projections in
// src/client/src/lib/platform/agents/index.ts.
const (
	LifecycleStatusAttr         = "openlit.lifecycle.status"
	LifecycleStatusRunning      = "running"
	LifecycleStatusStopped      = "stopped"
	LifecycleStatusRestarting   = "restarting"
	K8sSavedReplicasAnnotation  = "openlit.io/saved-replicas"
	K8sRolloutRestartAnnotation = "openlit.io/restartedAt"
)

func New(logger *zap.Logger, obiBinaryPath, otlpEndpoint, procRoot, environment, sdkVersion string, mode config.DeployMode) *Engine {
	if procRoot == "" {
		procRoot = "/proc"
	}

	container := NewContainerEnricher(logger, mode)

	logger.Info("engine created",
		zap.String("deploy_mode", string(mode)),
		zap.String("proc_root", procRoot),
		zap.String("obi_binary", obiBinaryPath),
		zap.String("otlp_endpoint", otlpEndpoint),
		zap.String("sdk_version", sdkVersion),
	)

	return &Engine{
		services: make(map[string]*openlit.ServiceState),
		patterns: make(map[string]instrumentPattern),
		logger:   logger,
		obi:      NewOBIManager(obiBinaryPath, logger),
		exportCfg: ExportConfig{
			OTLPEndpoint: otlpEndpoint,
			OTLPProtocol: "http/protobuf",
		},
		procRoot:    procRoot,
		deployMode:  mode,
		container:   container,
		environment: environment,
		sdkVersion:  sdkVersion,
	}
}

func (e *Engine) Start(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	ctx, e.cancel = context.WithCancel(ctx)
	e.appCtx = ctx
	e.running = true

	e.logger.Info("engine starting",
		zap.String("mode", string(e.deployMode)),
		zap.String("proc_root", e.procRoot),
	)

	sc, err := scanner.New(e.logger, e.procRoot)
	if err != nil {
		e.logger.Warn("eBPF scanner unavailable; discovery disabled", zap.Error(err))
	} else {
		e.scanner = sc
		if len(e.customHosts) > 0 {
			e.scanner.UpdateCustomHosts(e.customHosts)
		}
		go e.scanner.Run(ctx)
		go e.consumeScannerEvents(ctx)
	}

	go e.pruneStaleServices(ctx)

	e.logger.Info("engine started")
	return nil
}

func (e *Engine) Stop() {
	if e.cancel != nil {
		e.cancel()
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	if e.scanner != nil {
		e.scanner.Close()
	}
	if err := e.obi.Stop(); err != nil {
		e.logger.Warn("OBI stop error", zap.Error(err))
	}
	e.running = false
	e.logger.Info("engine stopped")
}

// InstrumentService derives a pattern from the service metadata, adds it,
// and restarts OBI with all active patterns.
func (e *Engine) InstrumentService(serviceID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	svc, ok := e.services[serviceID]
	if !ok {
		return fmt.Errorf("service %q not found", serviceID)
	}

	if _, exists := e.patterns[serviceID]; exists {
		return nil // already instrumented
	}

	pat := derivePattern(svc, e.deployMode)
	e.patterns[serviceID] = pat

	e.logger.Info("instrumented service",
		zap.String("service", svc.ServiceName),
		zap.String("exe_pattern", pat.ExePath),
		zap.String("cmd_pattern", pat.CmdArgs),
		zap.Ints("target_pids", pat.TargetPIDs),
		zap.String("k8s_namespace", pat.K8sNamespace),
		zap.String("k8s_pod_name", pat.K8sPodName),
		zap.String("k8s_deployment", pat.K8sDeployment),
		zap.String("k8s_daemonset", pat.K8sDaemonSet),
		zap.String("k8s_statefulset", pat.K8sStatefulSet),
	)
	if err := e.rebuildOBI(); err != nil {
		delete(e.patterns, serviceID)
		return err
	}
	svc.InstrumentationStatus = "instrumented"
	return nil
}

// UninstrumentService removes the pattern and restarts or stops OBI.
func (e *Engine) UninstrumentService(serviceID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	svc, ok := e.services[serviceID]
	if !ok {
		return fmt.Errorf("service %q not found", serviceID)
	}

	oldPattern := e.patterns[serviceID]
	delete(e.patterns, serviceID)

	e.logger.Info("uninstrumented service", zap.String("service", svc.ServiceName))

	var err error
	if len(e.patterns) == 0 {
		err = e.obi.Stop()
	} else {
		err = e.rebuildOBI()
	}
	if err != nil {
		e.patterns[serviceID] = oldPattern
		return err
	}
	svc.InstrumentationStatus = "discovered"
	return nil
}

func (e *Engine) rebuildOBI() error {
	entries := make([]obiTarget, 0, len(e.patterns))
	for id, p := range e.patterns {
		entry := obiTarget{
			Path:           p.ExePath,
			CmdArgs:        p.CmdArgs,
			TargetPIDs:     p.TargetPIDs,
			ContainersOnly: p.ContainersOnly,
			K8sNamespace:   p.K8sNamespace,
			K8sPodName:     p.K8sPodName,
			K8sDeployment:  p.K8sDeployment,
			K8sDaemonSet:   p.K8sDaemonSet,
			K8sStatefulSet: p.K8sStatefulSet,
		}
		svc, ok := e.services[id]
		if ok {
			// The controller is the naming authority: it discovers the workload
			// (and resolves any user-set OTEL_SERVICE_NAME) before OBI runs, so it
			// sets the per-target service name OBI emits under. This keeps trace
			// ServiceName aligned with the agents summary in every mode. OBI's
			// instrument[].name is scoped per-target (each entry is matched to one
			// workload via target_pids/pod/deployment), so this does not mislabel
			// other containers, and it takes precedence over OBI's auto-derived name.
			entry.Name = svc.ServiceName
		}
		if e.deployMode == config.DeployDocker && !entry.ContainersOnly {
			entry.ContainersOnly = true
		}
		entries = append(entries, entry)
	}
	cfg := BuildInstrumentConfig(
		e.exportCfg,
		entries,
		e.enabledProvidersForPatterns(),
		e.customHosts,
		e.deployMode,
		e.environment,
	)
	ctx := e.appCtx
	if ctx == nil {
		ctx = context.Background()
	}
	if e.obi.IsRunning() {
		return e.obi.Restart(ctx, cfg)
	}
	return e.obi.Start(ctx, cfg)
}

func (e *Engine) enabledProvidersForPatterns() map[string]bool {
	enabled := make(map[string]bool)
	for id := range e.patterns {
		if svc, ok := e.services[id]; ok {
			for _, provider := range svc.LLMProviders {
				enabled[provider] = true
			}
		}
	}
	return enabled
}

// derivePattern generates workload-scoped OBI selectors from service metadata.
func derivePattern(svc *openlit.ServiceState, mode config.DeployMode) instrumentPattern {
	pat := instrumentPattern{ServiceID: svc.ID}

	switch mode {
	case config.DeployKubernetes:
		if svc.ResourceAttributes != nil {
			pat.K8sNamespace = svc.ResourceAttributes["k8s.namespace.name"]
			workloadKind := svc.ResourceAttributes["k8s.workload.kind"]
			if svc.DeploymentName != "" {
				switch workloadKind {
				case "DaemonSet":
					pat.K8sDaemonSet = svc.DeploymentName
				case "StatefulSet":
					pat.K8sStatefulSet = svc.DeploymentName
				default:
					pat.K8sDeployment = svc.DeploymentName
				}
			} else {
				pat.K8sPodName = svc.ResourceAttributes["k8s.pod.name"]
			}
		}
		if pat.K8sNamespace != "" && (pat.K8sDeployment != "" || pat.K8sDaemonSet != "" || pat.K8sStatefulSet != "" || pat.K8sPodName != "") {
			return pat
		}
	case config.DeployDocker:
		pat.ContainersOnly = true
		if svc.PID > 0 {
			pat.TargetPIDs = []int{svc.PID}
			return pat
		}
	default:
		if svc.PID > 0 {
			pat.TargetPIDs = []int{svc.PID}
			return pat
		}
	}

	runtime := strings.ToLower(svc.LanguageRuntime)
	switch {
	case strings.Contains(runtime, "python"):
		pat.ExePath = "*python*"
	case strings.Contains(runtime, "node"):
		pat.ExePath = "*node*"
	case strings.Contains(runtime, "java"):
		pat.ExePath = "*java*"
	case strings.Contains(runtime, "ruby"):
		pat.ExePath = "*ruby*"
	default:
		if svc.ExePath != "" {
			pat.ExePath = "*" + filepath.Base(svc.ExePath) + "*"
		}
	}
	if script := extractScriptArg(svc.Cmdline); script != "" {
		pat.CmdArgs = "*" + script + "*"
	}

	return pat
}

func instrumentPatternEqual(a, b instrumentPattern) bool {
	if a.ServiceID != b.ServiceID ||
		a.ExePath != b.ExePath ||
		a.CmdArgs != b.CmdArgs ||
		a.ContainersOnly != b.ContainersOnly ||
		a.K8sNamespace != b.K8sNamespace ||
		a.K8sPodName != b.K8sPodName ||
		a.K8sDeployment != b.K8sDeployment ||
		a.K8sDaemonSet != b.K8sDaemonSet ||
		a.K8sStatefulSet != b.K8sStatefulSet ||
		len(a.TargetPIDs) != len(b.TargetPIDs) {
		return false
	}
	for i := range a.TargetPIDs {
		if a.TargetPIDs[i] != b.TargetPIDs[i] {
			return false
		}
	}
	return true
}

// extractScriptArg finds the first non-flag argument in a cmdline string,
// which is typically the script or entrypoint (e.g. "app.py" from "python -u app.py").
func extractScriptArg(cmdline string) string {
	parts := strings.Fields(cmdline)
	if len(parts) < 2 {
		return ""
	}
	for _, arg := range parts[1:] {
		if !strings.HasPrefix(arg, "-") {
			return filepath.Base(arg)
		}
	}
	return ""
}

func (e *Engine) GetServices() []openlit.ServiceState {
	e.mu.RLock()
	defer e.mu.RUnlock()

	result := make([]openlit.ServiceState, 0, len(e.services))
	for _, svc := range e.services {
		result = append(result, *svc)
	}
	return result
}

func (e *Engine) IsRunning() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.running
}

func (e *Engine) ControllerMode() openlit.ControllerMode {
	switch e.deployMode {
	case config.DeployKubernetes:
		return openlit.ModeKubernetes
	case config.DeployDocker:
		return openlit.ModeDocker
	default:
		return openlit.ModeLinux
	}
}

func (e *Engine) ControllerCapabilities() []string {
	capabilities := []string{CapabilityOBILLMObservability}

	switch e.deployMode {
	case config.DeployKubernetes:
		if e.container != nil && e.container.k8sClient != nil {
			capabilities = append(capabilities, CapabilityPythonSDKKubernetesV1)
			capabilities = append(capabilities, CapabilityLifecycleKubernetesV1)
		}
	case config.DeployDocker:
		if e.container != nil && e.container.dockerClient != nil && e.container.dockerClient.canManage() {
			capabilities = append(capabilities, CapabilityPythonSDKDockerV1)
			capabilities = append(capabilities, CapabilityLifecycleDockerV1)
		}
	default:
		capabilities = append(capabilities, CapabilityPythonSDKLinuxBareV1)
		capabilities = append(capabilities, CapabilityLifecycleLinuxBareV1)
		if linuxSystemdSDKSupported() {
			capabilities = append(capabilities, CapabilityPythonSDKLinuxSystemdV1)
			capabilities = append(capabilities, CapabilityLifecycleLinuxSystemdV1)
		}
	}

	return capabilities
}

// UpdateExportConfig replaces the runtime export settings. If OBI-relevant
// fields (endpoint, protocol) changed and OBI is running, it triggers a
// rebuildOBI so the new config takes effect immediately.
func (e *Engine) UpdateExportConfig(cfg ExportConfig) {
	e.mu.Lock()
	defer e.mu.Unlock()

	obiChanged := cfg.OTLPEndpoint != e.exportCfg.OTLPEndpoint ||
		cfg.OTLPProtocol != e.exportCfg.OTLPProtocol ||
		cfg.OTLPTracesEndpoint != e.exportCfg.OTLPTracesEndpoint

	e.exportCfg = cfg
	e.logger.Info("export config updated",
		zap.String("otlp_endpoint", cfg.OTLPEndpoint),
		zap.String("otlp_protocol", cfg.OTLPProtocol),
		zap.String("otlp_traces_endpoint", cfg.OTLPTracesEndpoint),
		zap.String("otlp_metrics_endpoint", cfg.OTLPMetricsEndpoint),
		zap.String("otlp_logs_endpoint", cfg.OTLPLogsEndpoint),
	)

	if obiChanged && e.obi.IsRunning() {
		if err := e.rebuildOBI(); err != nil {
			e.logger.Error("failed to rebuild OBI after export config update", zap.Error(err))
		}
	}
}

// UpdateCustomHosts stores the user-configured custom LLM host specs and, if
// the scanner is already running, applies them immediately. Specs are
// "host[:port]" strings (e.g. "litellm.internal:4000", "ollama.local:11434").
// If the scanner has not started yet, the specs are applied when it does.
func (e *Engine) UpdateCustomHosts(specs []string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if stringSliceEqual(e.customHosts, specs) {
		return
	}
	e.customHosts = append([]string(nil), specs...)
	e.logger.Info("custom LLM hosts configured", zap.Strings("hosts", specs))

	if e.scanner != nil {
		e.scanner.UpdateCustomHosts(e.customHosts)
	}

	// The host list also feeds OBI's custom-gateway extractor gate
	// (GenAI.Custom.Hosts) via BuildInstrumentConfig. If OBI is already running,
	// rebuild so the updated hosts take effect immediately; otherwise the next
	// instrumentation picks them up. Only rebuild when running to avoid spurious
	// restarts before any workload is instrumented.
	if e.obi.IsRunning() {
		if err := e.rebuildOBI(); err != nil {
			e.logger.Error("failed to rebuild OBI after custom hosts update", zap.Error(err))
		}
	}
}

func stringSliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// GetExportConfig returns a snapshot of the current export configuration.
// The returned value is a deep copy safe for use outside the engine lock.
func (e *Engine) GetExportConfig() ExportConfig {
	e.mu.RLock()
	defer e.mu.RUnlock()

	cfg := e.exportCfg
	if cfg.OTLPHeaders != nil {
		cloned := make(map[string]string, len(cfg.OTLPHeaders))
		for k, v := range cfg.OTLPHeaders {
			cloned[k] = v
		}
		cfg.OTLPHeaders = cloned
	}
	return cfg
}

func (e *Engine) pruneStaleServices(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.mu.Lock()
			cutoff := time.Now().Add(-30 * time.Minute)
			pruned := 0
			for id, svc := range e.services {
				if svc.LastSeen.Before(cutoff) && svc.InstrumentationStatus != "instrumented" {
					delete(e.services, id)
					pruned++
				}
			}
			e.mu.Unlock()
			if pruned > 0 {
				e.logger.Info("pruned stale services", zap.Int("count", pruned))
			}
		}
	}
}

func (e *Engine) ServiceCount() (discovered, instrumented int) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	for _, svc := range e.services {
		discovered++
		if svc.InstrumentationStatus == "instrumented" ||
			svc.AgentObservabilityStatus == "enabled" {
			instrumented++
		}
	}
	return
}

// setLifecycleState stamps the lifecycle status onto the matching in-memory
// service so the next heartbeat reports it. Mirrors the
// applyAgentStateLocked / setAgentObservabilityState pattern in python_sdk.go
// and uses the same resource_attributes channel
// (openlit.lifecycle.status) for the dashboard rollup.
//
// On Stop the scanner is likely to lose sight of the workload immediately
// (the process exits / container exits / pod is gone), so this helper is the
// last chance the controller has to surface the "stopped" state to the UI
// before the row falls out of the heartbeat window. We also refresh
// LastSeen so the row survives the next prune cycle (30-minute
// not-instrumented cutoff in pruneStaleServices) while the user decides
// whether to Play it back.
func (e *Engine) setLifecycleState(workloadKey, status string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	svc, ok := e.services[workloadKey]
	if !ok {
		return
	}
	svc.LifecycleStatus = status
	svc.LastSeen = time.Now()
	if svc.ResourceAttributes == nil {
		svc.ResourceAttributes = make(map[string]string)
	}
	if status != "" {
		svc.ResourceAttributes[LifecycleStatusAttr] = status
	} else {
		delete(svc.ResourceAttributes, LifecycleStatusAttr)
	}
}

// snapshotService returns a defensive copy of a service entry so callers
// can read its identity (workload_key, namespace, service_name,
// container name) without holding the engine lock.
func (e *Engine) snapshotService(workloadKey string) (*openlit.ServiceState, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	svc, ok := e.services[workloadKey]
	if !ok {
		return nil, fmt.Errorf("service %q not found", workloadKey)
	}
	copied := *svc
	if svc.ResourceAttributes != nil {
		clone := make(map[string]string, len(svc.ResourceAttributes))
		for k, v := range svc.ResourceAttributes {
			clone[k] = v
		}
		copied.ResourceAttributes = clone
	}
	// Clone slices too — a shallow struct copy shares the backing arrays with
	// the live map entry, so a caller appending/mutating would race the engine.
	if svc.LLMProviders != nil {
		copied.LLMProviders = append([]string(nil), svc.LLMProviders...)
	}
	if svc.OpenPorts != nil {
		copied.OpenPorts = append([]uint16(nil), svc.OpenPorts...)
	}
	return &copied, nil
}
