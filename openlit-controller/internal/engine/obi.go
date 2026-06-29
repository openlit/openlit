package engine

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

// OBIManager manages the OBI (OpenTelemetry eBPF Instrumentation) child process.
type OBIManager struct {
	mu         sync.Mutex
	cmd        *exec.Cmd
	cancel     context.CancelFunc
	waitDone   chan struct{}
	binaryPath string
	configPath string
	logger     *zap.Logger
	running    bool
	stopping   bool // set before signalling an intentional Stop, so the wait goroutine does not auto-restart
	lastConfig *OBIConfig
}

const (
	obiStopGracePeriod = 1500 * time.Millisecond
	obiStopKillWait    = 1 * time.Second
)

func NewOBIManager(binaryPath string, logger *zap.Logger) *OBIManager {
	m := &OBIManager{
		binaryPath: binaryPath,
		configPath: fmt.Sprintf("/tmp/obi-config-%d.yaml", os.Getpid()),
		logger:     logger,
	}

	if _, err := os.Stat(binaryPath); err != nil {
		logger.Warn("OBI binary not found; instrumentation will be unavailable until binary is installed",
			zap.String("path", binaryPath),
		)
	}

	return m
}

func (m *OBIManager) Start(ctx context.Context, cfg OBIConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return fmt.Errorf("OBI already running")
	}

	if _, err := os.Stat(m.binaryPath); err != nil {
		return fmt.Errorf("OBI binary not found at %s: %w", m.binaryPath, err)
	}

	if err := m.writeConfig(cfg); err != nil {
		return fmt.Errorf("writing OBI config: %w", err)
	}

	childCtx, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	m.waitDone = make(chan struct{})
	m.stopping = false

	m.cmd = exec.CommandContext(childCtx, m.binaryPath, "--config", m.configPath)
	m.cmd.Env = os.Environ()
	if len(cfg.ResourceAttrs) > 0 {
		var parts []string
		for k, v := range cfg.ResourceAttrs {
			parts = append(parts, k+"="+v)
		}
		m.cmd.Env = append(m.cmd.Env, "OTEL_RESOURCE_ATTRIBUTES="+strings.Join(parts, ","))
	}
	m.cmd.Stdout = newLogWriter(m.logger, "[obi]", false)
	m.cmd.Stderr = newLogWriter(m.logger, "[obi]", true)

	if err := m.cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("starting OBI: %w", err)
	}

	cfgCopy := cfg
	m.lastConfig = &cfgCopy
	m.running = true
	m.logger.Info("OBI started", zap.Int("pid", m.cmd.Process.Pid))

	cmd := m.cmd
	waitDone := m.waitDone

	go func() {
		err := cmd.Wait()
		m.mu.Lock()
		lastCfg := m.lastConfig
		intentional := m.stopping
		m.running = false
		if m.cmd == cmd {
			m.cmd = nil
			m.cancel = nil
			m.waitDone = nil
		}
		m.mu.Unlock()
		close(waitDone)

		// An intentional Stop sets m.stopping before signalling, so we must not
		// auto-restart. We check the flag (set under lock above) in addition to
		// childCtx.Err(): Stop() sends SIGTERM before calling cancel(), so the
		// process can exit while childCtx.Err() is still nil — without the flag
		// this goroutine would spuriously resurrect a just-stopped OBI.
		if intentional || childCtx.Err() != nil {
			m.logger.Debug("OBI stopped (intentional)")
			return
		}
		if err != nil {
			m.logger.Error("OBI exited unexpectedly", zap.Error(err))
		}

		if lastCfg != nil {
			go m.restartWithBackoff(ctx, *lastCfg)
		}
	}()

	return nil
}

func (m *OBIManager) Stop() error {
	m.mu.Lock()
	if !m.running || m.cmd == nil || m.cmd.Process == nil {
		m.running = false
		m.cmd = nil
		m.cancel = nil
		m.waitDone = nil
		m.mu.Unlock()
		return nil
	}
	cmd := m.cmd
	cancel := m.cancel
	waitDone := m.waitDone
	// Mark intentional stop BEFORE signalling so the wait goroutine (which may
	// wake from SIGTERM before cancel() runs) does not auto-restart.
	m.stopping = true
	m.mu.Unlock()

	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		m.logger.Warn("failed to send SIGTERM to OBI", zap.Error(err))
	}

	select {
	case <-waitDone:
		m.logger.Debug("OBI stopped gracefully")
	case <-time.After(obiStopGracePeriod):
		m.logger.Warn("OBI did not exit after SIGTERM, sending SIGKILL")
		if err := cmd.Process.Kill(); err != nil {
			m.logger.Warn("failed to SIGKILL OBI", zap.Error(err))
		}
		select {
		case <-waitDone:
		case <-time.After(obiStopKillWait):
			m.logger.Warn("OBI wait did not finish after SIGKILL; continuing shutdown")
		}
	}

	if cancel != nil {
		cancel()
	}

	m.mu.Lock()
	if m.cmd == cmd || !m.running {
		m.running = false
		m.cmd = nil
		m.cancel = nil
		m.waitDone = nil
	}
	m.mu.Unlock()

	if err := os.Remove(m.configPath); err != nil && !os.IsNotExist(err) {
		m.logger.Debug("failed to remove OBI config file", zap.String("path", m.configPath), zap.Error(err))
	}
	return nil
}

func (m *OBIManager) Restart(ctx context.Context, cfg OBIConfig) error {
	if err := m.Stop(); err != nil {
		m.logger.Warn("error stopping OBI before restart", zap.Error(err))
	}
	return m.Start(ctx, cfg)
}

func (m *OBIManager) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}

const (
	obiRestartMaxAttempts  = 5
	obiRestartInitialDelay = 2 * time.Second
	obiRestartMaxDelay     = 60 * time.Second
)

func (m *OBIManager) restartWithBackoff(ctx context.Context, cfg OBIConfig) {
	delay := obiRestartInitialDelay
	for attempt := 1; attempt <= obiRestartMaxAttempts; attempt++ {
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}

		m.mu.Lock()
		if m.running {
			m.mu.Unlock()
			return
		}
		m.mu.Unlock()

		m.logger.Warn("attempting OBI auto-restart",
			zap.Int("attempt", attempt),
			zap.Duration("delay", delay),
		)
		if err := m.Start(ctx, cfg); err != nil {
			m.logger.Error("OBI auto-restart failed", zap.Int("attempt", attempt), zap.Error(err))
			delay = delay * 2
			if delay > obiRestartMaxDelay {
				delay = obiRestartMaxDelay
			}
			continue
		}
		m.logger.Info("OBI auto-restart succeeded", zap.Int("attempt", attempt))
		return
	}
	m.logger.Error("OBI auto-restart exhausted all attempts", zap.Int("max_attempts", obiRestartMaxAttempts))
}

func (m *OBIManager) writeConfig(cfg OBIConfig) error {
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshalling OBI config: %w", err)
	}
	return os.WriteFile(m.configPath, data, 0644)
}

// OBI YAML config structures

type OBIConfig struct {
	LogLevel     string        `yaml:"log_level,omitempty"`
	EBPF         obiEBPF       `yaml:"ebpf"`
	OTELTraces   obiOTELTraces `yaml:"otel_traces_export"`
	TracePrinter string        `yaml:"trace_printer,omitempty"`
	Routes       obiRoutes     `yaml:"routes,omitempty"`
	Discovery    obiDiscovery  `yaml:"discovery,omitempty"`
	Attributes   obiAttributes `yaml:"attributes,omitempty"`

	// ResourceAttrs are passed as OTEL_RESOURCE_ATTRIBUTES env var to the OBI process.
	// Not serialized to YAML; used by OBIManager.Start.
	ResourceAttrs map[string]string `yaml:"-"`
}

type obiEBPF struct {
	BufferSizes       obiBufferSizes `yaml:"buffer_sizes"`
	ProtocolDebug     bool           `yaml:"protocol_debug_print,omitempty"`
	PayloadExtraction obiPayload     `yaml:"payload_extraction"`
}

type obiBufferSizes struct {
	HTTP uint32 `yaml:"http"`
}

type obiPayload struct {
	HTTP obiHTTP `yaml:"http"`
}

type obiHTTP struct {
	GenAI obiGenAI `yaml:"genai"`
}

// obiGenAI mirrors OBI v0.9.0's genai payload-extraction config, plus our two
// added extractors (custom, ollama). OBI natively parses OpenAI, Anthropic,
// Gemini, Qwen, and Bedrock; the many OpenAI-compatible SaaS providers
// (Groq, Mistral, Together, ...) are all handled by the OpenAI parser, so we do
// not carry a separate flag per vendor — discovery maps them to "openai".
type obiGenAI struct {
	OpenAI    obiEnabled       `yaml:"openai"`
	Anthropic obiEnabled       `yaml:"anthropic"`
	Gemini    obiEnabled       `yaml:"gemini"`
	Qwen      obiEnabled       `yaml:"qwen"`
	Bedrock   obiEnabled       `yaml:"bedrock"`
	Custom    obiCustomEnabled `yaml:"custom"`
	Ollama    obiEnabled       `yaml:"ollama"`
}

type obiEnabled struct {
	Enabled bool `yaml:"enabled"`
}

// obiCustomEnabled carries the configured gateway destinations so OBI only
// parses traffic to a known custom gateway as a custom GenAI span.
type obiCustomEnabled struct {
	Enabled bool     `yaml:"enabled"`
	Hosts   []string `yaml:"hosts,omitempty"`
}

type obiOTELTraces struct {
	Endpoint string `yaml:"endpoint"`
	Protocol string `yaml:"protocol"`
}

type obiRoutes struct {
	Unmatched string `yaml:"unmatched,omitempty"`
}

type obiDiscovery struct {
	ExcludeOTelInstrumented *bool       `yaml:"exclude_otel_instrumented_services,omitempty"`
	Instrument              []obiTarget `yaml:"instrument,omitempty"`
}

type obiTarget struct {
	Name           string `yaml:"name,omitempty"`
	Path           string `yaml:"exe_path,omitempty"`
	CmdArgs        string `yaml:"cmd_args,omitempty"`
	TargetPIDs     []int  `yaml:"target_pids,omitempty"`
	ContainersOnly bool   `yaml:"containers_only,omitempty"`
	K8sNamespace   string `yaml:"k8s_namespace,omitempty"`
	K8sPodName     string `yaml:"k8s_pod_name,omitempty"`
	K8sDeployment  string `yaml:"k8s_deployment_name,omitempty"`
	K8sDaemonSet   string `yaml:"k8s_daemonset_name,omitempty"`
	K8sStatefulSet string `yaml:"k8s_statefulset_name,omitempty"`
}

type obiAttributes struct {
	Kubernetes obiK8sAttrs      `yaml:"kubernetes,omitempty"`
	Select     obiAttrSelection `yaml:"select,omitempty"`
}

type obiK8sAttrs struct {
	Enable string `yaml:"enable,omitempty"`
}

type obiAttrSelection map[string]obiAttrIncludeExclude

type obiAttrIncludeExclude struct {
	Include []string `yaml:"include,omitempty"`
}

// BuildInstrumentConfig creates an OBI config from pattern-based entries.
func BuildInstrumentConfig(
	expCfg ExportConfig,
	entries []obiTarget,
	enabledProviders map[string]bool,
	customHosts []string,
	mode config.DeployMode,
	environment string,
) OBIConfig {
	tracesEndpoint := expCfg.OTLPTracesEndpoint
	if tracesEndpoint == "" {
		tracesEndpoint = expCfg.OTLPEndpoint
	}
	protocol := expCfg.OTLPProtocol
	if protocol == "" {
		protocol = "http/protobuf"
	}

	excludeOTel := true

	cfg := OBIConfig{
		LogLevel:     "info",
		TracePrinter: "text",
		OTELTraces: obiOTELTraces{
			Endpoint: tracesEndpoint,
			Protocol: protocol,
		},
		Routes: obiRoutes{
			Unmatched: "heuristic",
		},
		Discovery: obiDiscovery{
			ExcludeOTelInstrumented: &excludeOTel,
			Instrument:              entries,
		},
	}

	cfg.EBPF.BufferSizes.HTTP = 8192
	cfg.EBPF.ProtocolDebug = false

	// OBI has native parsers only for OpenAI, Anthropic, Gemini, Qwen, and
	// Bedrock. Every other OpenAI-wire-compatible SaaS provider we discover
	// (Cohere/Mistral/Groq/Deepseek/Together/Fireworks/Vercel/Vertex/Azure...)
	// is parsed by the OpenAI extractor, so enabling any of them enables OpenAI.
	openAICompatible := []string{
		"openai", "cohere", "mistral", "groq", "deepseek", "together",
		"fireworks", "azure_inference", "azure_openai", "vercel_ai", "vertex_ai",
	}
	for _, p := range openAICompatible {
		if enabledProviders[p] {
			cfg.EBPF.PayloadExtraction.HTTP.GenAI.OpenAI.Enabled = true
			break
		}
	}
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.Anthropic.Enabled = enabledProviders["anthropic"]
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.Gemini.Enabled = enabledProviders["gemini"]
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.Qwen.Enabled = enabledProviders["qwen"]
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.Bedrock.Enabled = enabledProviders["bedrock"]
	// Self-hosted gateways discovered via custom_llm_hosts.
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.Custom.Enabled = enabledProviders["custom"]
	if enabledProviders["custom"] {
		cfg.EBPF.PayloadExtraction.HTTP.GenAI.Custom.Hosts = customHosts
	}
	// Ollama native API: opt-in (not auto-enabled from discovery, which reports
	// custom gateways as "custom"). A user can enable it explicitly.
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.Ollama.Enabled = enabledProviders["ollama"]

	cfg.Attributes.Select = obiAttrSelection{
		"traces": {
			Include: []string{
				"gen_ai.input.messages",
				"gen_ai.output.messages",
				// Canonical GenAI semconv key is underscore-separated
				// (gen_ai.system_instructions). The dotted form silently fails to
				// match OBI's GenAIInstructions selector, dropping the attribute.
				"gen_ai.system_instructions",
				"gen_ai.metadata",
			},
		},
	}

	if mode == config.DeployKubernetes {
		cfg.Attributes.Kubernetes.Enable = "autodetect"
	}

	cfg.ResourceAttrs = map[string]string{
		"deployment.environment": environment,
		"telemetry.sdk.name":     "openlit",
	}

	return cfg
}

// logWriter adapts zap.Logger to io.Writer for OBI subprocess stdout/stderr.
type logWriter struct {
	logger *zap.Logger
	prefix string
	warn   bool
}

func newLogWriter(logger *zap.Logger, prefix string, warn bool) *logWriter {
	return &logWriter{logger: logger, prefix: prefix, warn: warn}
}

func (w *logWriter) Write(p []byte) (n int, err error) {
	msg := string(p)
	if len(msg) > 0 && msg[len(msg)-1] == '\n' {
		msg = msg[:len(msg)-1]
	}
	if w.warn {
		w.logger.Warn(w.prefix + " " + msg)
	} else {
		w.logger.Info(w.prefix + " " + msg)
	}
	return len(p), nil
}
