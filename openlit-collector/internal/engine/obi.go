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

	"github.com/openlit/openlit/openlit-collector/internal/config"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

// OBIManager manages the OBI (OpenTelemetry eBPF Instrumentation) child process.
type OBIManager struct {
	mu         sync.Mutex
	cmd        *exec.Cmd
	cancel     context.CancelFunc
	binaryPath string
	configPath string
	logger     *zap.Logger
	running    bool
}

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

	m.running = true
	m.logger.Info("OBI started", zap.Int("pid", m.cmd.Process.Pid))

	go func() {
		err := m.cmd.Wait()
		m.mu.Lock()
		m.running = false
		m.mu.Unlock()

		if childCtx.Err() != nil {
			m.logger.Debug("OBI stopped (context cancelled)")
			return
		}
		if err != nil {
			m.logger.Error("OBI exited unexpectedly", zap.Error(err))
		}
	}()

	return nil
}

func (m *OBIManager) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.running || m.cmd == nil || m.cmd.Process == nil {
		m.running = false
		return nil
	}

	if err := m.cmd.Process.Signal(syscall.SIGTERM); err != nil {
		m.logger.Warn("failed to send SIGTERM to OBI", zap.Error(err))
	}

	done := make(chan struct{})
	go func() {
		m.cmd.Wait()
		close(done)
	}()

	select {
	case <-done:
		m.logger.Debug("OBI stopped gracefully")
	case <-time.After(5 * time.Second):
		m.logger.Warn("OBI did not exit after SIGTERM, sending SIGKILL")
		m.cmd.Process.Kill()
		<-done
	}

	if m.cancel != nil {
		m.cancel()
		m.cancel = nil
	}
	m.running = false
	m.cmd = nil

	os.Remove(m.configPath)
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

type obiGenAI struct {
	OpenAI         obiEnabled `yaml:"openai"`
	Anthropic      obiEnabled `yaml:"anthropic"`
	Gemini         obiEnabled `yaml:"gemini"`
	AzureInference obiEnabled `yaml:"azure_inference"`
	Bedrock        obiEnabled `yaml:"bedrock"`
	VercelAI       obiEnabled `yaml:"vercel_ai"`
	LiteLLM        obiEnabled `yaml:"litellm"`
	Ollama         obiEnabled `yaml:"ollama"`
}

type obiEnabled struct {
	Enabled bool `yaml:"enabled"`
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
	ContainersOnly bool   `yaml:"containers_only,omitempty"`
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
// GenAI payload extraction is always enabled.
func BuildInstrumentConfig(otlpEndpoint string, entries []obiTarget, mode config.DeployMode, environment string) OBIConfig {
	excludeOTel := false

	cfg := OBIConfig{
		LogLevel:     "info",
		TracePrinter: "text",
		OTELTraces: obiOTELTraces{
			Endpoint: otlpEndpoint,
			Protocol: "http/protobuf",
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
	cfg.EBPF.ProtocolDebug = true
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.OpenAI.Enabled = true
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.Anthropic.Enabled = true
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.Gemini.Enabled = true
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.AzureInference.Enabled = true
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.Bedrock.Enabled = true
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.VercelAI.Enabled = true
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.LiteLLM.Enabled = true
	cfg.EBPF.PayloadExtraction.HTTP.GenAI.Ollama.Enabled = true

	cfg.Attributes.Select = obiAttrSelection{
		"traces": {
			Include: []string{
				"gen_ai.input.messages",
				"gen_ai.output.messages",
				"gen_ai.system.instructions",
				"gen_ai.metadata",
			},
		},
	}

	if mode == config.DeployKubernetes {
		cfg.Attributes.Kubernetes.Enable = "autodetect"
	}

	cfg.ResourceAttrs = map[string]string{
		"deployment.environment": environment,
		"telemetry.sdk.name":    "openlit",
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
