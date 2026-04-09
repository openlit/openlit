package engine

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/openlit/openlit/openlit-collector/internal/config"
	"github.com/openlit/openlit/openlit-collector/internal/openlit"
	"github.com/openlit/openlit/openlit-collector/internal/scanner"
	"go.uber.org/zap"
)

// InstrumentPattern represents a service pattern for OBI discovery.
type InstrumentPattern struct {
	ServiceID string
	ExePath   string // glob, e.g. "*python*"
	CmdArgs   string // glob, e.g. "*app.py*"
}

// Engine orchestrates the eBPF scanner and per-service OBI instrumentation.
type Engine struct {
	mu         sync.RWMutex
	cancel     context.CancelFunc
	services   map[string]*openlit.ServiceState
	logger     *zap.Logger
	running    bool

	scanner      *scanner.Scanner
	obi          *OBIManager
	otlpEndpoint string
	procRoot     string
	deployMode   config.DeployMode
	container    *ContainerEnricher
	environment  string

	patterns map[string]InstrumentPattern // serviceID -> pattern
}

func New(logger *zap.Logger, obiBinaryPath, otlpEndpoint, procRoot, environment string) *Engine {
	mode := config.DetectDeployMode()
	if procRoot == "" {
		procRoot = "/proc"
	}

	container := NewContainerEnricher(logger, mode)

	logger.Info("engine created",
		zap.String("deploy_mode", string(mode)),
		zap.String("proc_root", procRoot),
		zap.String("obi_binary", obiBinaryPath),
		zap.String("otlp_endpoint", otlpEndpoint),
	)

	return &Engine{
		services:     make(map[string]*openlit.ServiceState),
		patterns:     make(map[string]InstrumentPattern),
		logger:       logger,
		obi:          NewOBIManager(obiBinaryPath, logger),
		otlpEndpoint: otlpEndpoint,
		procRoot:     procRoot,
		deployMode:   mode,
		container:    container,
		environment:  environment,
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
	e.obi.Stop()
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

	pat := derivePattern(svc)
	e.patterns[serviceID] = pat
	svc.InstrumentationStatus = "instrumented"

	e.logger.Info("instrumented service",
		zap.String("service", svc.ServiceName),
		zap.String("exe_pattern", pat.ExePath),
		zap.String("cmd_pattern", pat.CmdArgs),
	)
	return e.rebuildOBI()
}

// UninstrumentService removes the pattern and restarts or stops OBI.
func (e *Engine) UninstrumentService(serviceID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	svc, ok := e.services[serviceID]
	if !ok {
		return fmt.Errorf("service %q not found", serviceID)
	}

	delete(e.patterns, serviceID)
	svc.InstrumentationStatus = "discovered"

	e.logger.Info("uninstrumented service", zap.String("service", svc.ServiceName))

	if len(e.patterns) == 0 {
		return e.obi.Stop()
	}
	return e.rebuildOBI()
}

func (e *Engine) rebuildOBI() error {
	entries := make([]obiTarget, 0, len(e.patterns))
	for id, p := range e.patterns {
		entry := obiTarget{
			Path:    p.ExePath,
			CmdArgs: p.CmdArgs,
		}
		if e.deployMode == config.DeployDocker {
			// In Docker mode, let OBI derive service names from container names
			// rather than using a static name that would label all matching
			// processes identically.
			entry.ContainersOnly = true
		} else if svc, ok := e.services[id]; ok {
			entry.Name = svc.ServiceName
		}
		entries = append(entries, entry)
	}
	cfg := BuildInstrumentConfig(e.otlpEndpoint, entries, e.deployMode, e.environment)
	if e.obi.IsRunning() {
		return e.obi.Restart(context.Background(), cfg)
	}
	return e.obi.Start(context.Background(), cfg)
}

// derivePattern generates OBI-compatible glob patterns from service metadata.
// For Docker containers, the cmdline (e.g. "python -u app.py") is the same across
// containers running the same image, so the pattern intentionally matches all of
// them. OBI's container awareness auto-names each by its Docker container name.
func derivePattern(svc *openlit.ServiceState) InstrumentPattern {
	pat := InstrumentPattern{ServiceID: svc.ID}

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

	// Use the actual script/jar name from the cmdline for cmd_args matching.
	if script := extractScriptArg(svc.Cmdline); script != "" {
		pat.CmdArgs = "*" + script + "*"
	}

	return pat
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

func (e *Engine) CollectorMode() openlit.CollectorMode {
	switch e.deployMode {
	case config.DeployKubernetes:
		return openlit.ModeKubernetes
	case config.DeployDocker:
		return openlit.ModeDocker
	default:
		return openlit.ModeLinux
	}
}

func (e *Engine) ServiceCount() (discovered, instrumented int) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	for _, svc := range e.services {
		discovered++
		if svc.InstrumentationStatus == "instrumented" {
			instrumented++
		}
	}
	return
}
