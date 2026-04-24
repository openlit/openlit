package engine

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
	"github.com/openlit/openlit/openlit-controller/internal/scanner"
	"go.uber.org/zap"
)

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
	services map[string]*openlit.ServiceState
	logger   *zap.Logger
	running  bool

	scanner      *scanner.Scanner
	obi          *OBIManager
	otlpEndpoint string
	procRoot     string
	deployMode   config.DeployMode
	container    *ContainerEnricher
	environment  string
	sdkVersion   string

	patterns map[string]instrumentPattern // serviceID -> pattern
}

const (
	CapabilityOBILLMObservability     = "obi_llm_observability"
	CapabilityPythonSDKKubernetesV1   = "python_sdk_injection_kubernetes_v1"
	CapabilityPythonSDKDockerV1       = "python_sdk_injection_docker_v1"
	CapabilityPythonSDKLinuxSystemdV1 = "python_sdk_injection_linux_systemd_v1"
	CapabilityPythonSDKLinuxBareV1    = "python_sdk_injection_linux_bare_v1"
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
		services:     make(map[string]*openlit.ServiceState),
		patterns:     make(map[string]instrumentPattern),
		logger:       logger,
		obi:          NewOBIManager(obiBinaryPath, logger),
		otlpEndpoint: otlpEndpoint,
		procRoot:     procRoot,
		deployMode:   mode,
		container:    container,
		environment:  environment,
		sdkVersion:   sdkVersion,
	}
}

func (e *Engine) Start(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	ctx, e.cancel = context.WithCancel(ctx)
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
		go e.scanner.Run(ctx)
		go e.consumeScannerEvents(ctx)
	}

	e.logger.Info("engine started")
	return nil
}

func (e *Engine) Stop() {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.cancel != nil {
		e.cancel()
	}
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
		if ok && e.deployMode != config.DeployDocker {
			// In Docker mode OBI should keep container-derived naming instead of
			// applying a static service name to every matching container.
			entry.Name = svc.ServiceName
		}
		if e.deployMode == config.DeployDocker && !entry.ContainersOnly {
			entry.ContainersOnly = true
		}
		entries = append(entries, entry)
	}
	cfg := BuildInstrumentConfig(
		e.otlpEndpoint,
		entries,
		e.enabledProvidersForPatterns(),
		e.deployMode,
		e.environment,
	)
	if e.obi.IsRunning() {
		return e.obi.Restart(context.Background(), cfg)
	}
	return e.obi.Start(context.Background(), cfg)
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
		}
	case config.DeployDocker:
		if e.container != nil && e.container.dockerClient != nil && e.container.dockerClient.canManage() {
			capabilities = append(capabilities, CapabilityPythonSDKDockerV1)
		}
	default:
		capabilities = append(capabilities, CapabilityPythonSDKLinuxBareV1)
		if linuxSystemdSDKSupported() {
			capabilities = append(capabilities, CapabilityPythonSDKLinuxSystemdV1)
		}
	}

	return capabilities
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
