package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/engine"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
	"github.com/openlit/openlit/openlit-controller/internal/server"
	"go.uber.org/zap"
)

func main() {
	configPath := flag.String("config", "", "path to config file")
	openlitURL := flag.String("openlit-url", "", "OpenLIT dashboard URL")
	flag.Parse()

	logger, _ := zap.NewProduction()
	defer func() { _ = logger.Sync() }()

	if *openlitURL != "" {
		os.Setenv("OPENLIT_URL", *openlitURL)
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		logger.Fatal("failed to load config", zap.Error(err))
	}

	logger.Info("openlit-controller starting",
		zap.String("openlit_url", cfg.OpenlitURL),
		zap.String("api_listen", cfg.APIListen),
		zap.Duration("poll_interval", cfg.PollInterval),
		zap.String("obi_binary", cfg.OBIBinaryPath),
		zap.String("otlp_endpoint", cfg.OTLPEndpoint),
		zap.String("proc_root", cfg.ProcRoot),
	)

	eng := engine.New(logger, cfg.OBIBinaryPath, cfg.OTLPEndpoint, cfg.ProcRoot, cfg.Environment, cfg.SDKVersion, cfg.DeployMode)
	client := openlit.NewClient(cfg.OpenlitURL, cfg.APIKey, logger)

	var mode openlit.ControllerMode
	switch cfg.DeployMode {
	case config.DeployKubernetes:
		mode = openlit.ModeKubernetes
	case config.DeployDocker:
		mode = openlit.ModeDocker
	default:
		mode = openlit.ModeLinux
	}
	nodeName, _ := os.Hostname()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := eng.Start(ctx); err != nil {
		logger.Fatal("failed to start engine", zap.Error(err))
	}

	srv := server.New(cfg.APIListen, eng, logger)
	fatalCh := make(chan error, 1)
	go func() {
		if err := srv.Start(); err != nil && err != http.ErrServerClosed {
			logger.Error("REST API server failed", zap.Error(err))
			select {
			case fatalCh <- err:
			default:
			}
		}
	}()

	controllerAttrs := buildControllerResourceAttrs(mode, cfg.Environment, eng.ControllerCapabilities())
	go runPollLoop(ctx, client, eng, logger, cfg.PollInterval, nodeName, mode, cfg.ClusterID, controllerAttrs)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-sigCh:
		logger.Info("received shutdown signal")
	case err := <-fatalCh:
		logger.Error("initiating shutdown due to fatal component error", zap.Error(err))
	}

	cancel()
	logger.Info("shutting down")
	eng.Stop()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Warn("HTTP server shutdown error", zap.Error(err))
	}
}

func runPollLoop(
	ctx context.Context,
	client *openlit.Client,
	eng *engine.Engine,
	logger *zap.Logger,
	interval time.Duration,
	nodeName string,
	mode openlit.ControllerMode,
	clusterID string,
	controllerAttrs map[string]string,
) {
	iid := instanceID(mode)
	currentInterval := interval
	var currentConfigHash string

	resp := doPoll(ctx, client, eng, logger, iid, nodeName, mode, clusterID, nil, controllerAttrs, currentConfigHash)

	ticker := time.NewTicker(currentInterval)
	defer ticker.Stop()

	var pendingResults []openlit.ActionResult
	if resp != nil {
		pendingResults = resp.actionResults
		if resp.configHash != "" {
			currentConfigHash = resp.configHash
		}
		if next := resp.pollInterval; next > 0 && next != currentInterval {
			currentInterval = next
			ticker.Reset(currentInterval)
			logger.Info("poll interval updated from config", zap.Duration("interval", currentInterval))
		}
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			resp := doPoll(ctx, client, eng, logger, iid, nodeName, mode, clusterID, pendingResults, controllerAttrs, currentConfigHash)
			if resp != nil {
				pendingResults = resp.actionResults
				if resp.configHash != "" {
					currentConfigHash = resp.configHash
				}
				if next := resp.pollInterval; next > 0 && next != currentInterval {
					currentInterval = next
					ticker.Reset(currentInterval)
					logger.Info("poll interval updated from config", zap.Duration("interval", currentInterval))
				}
			}
		}
	}
}

type pollResult struct {
	actionResults []openlit.ActionResult
	pollInterval  time.Duration
	configHash    string
}

func doPoll(
	_ context.Context,
	client *openlit.Client,
	eng *engine.Engine,
	logger *zap.Logger,
	instanceID string,
	nodeName string,
	mode openlit.ControllerMode,
	clusterID string,
	actionResults []openlit.ActionResult,
	controllerAttrs map[string]string,
	configHash string,
) *pollResult {
	discovered, instrumented := eng.ServiceCount()

	services := eng.GetServices()
	dsvcs := make([]openlit.DiscoveredService, 0, len(services))
	for _, svc := range services {
		dsvcs = append(dsvcs, openlit.DiscoveredService{
			ServiceName:              svc.ServiceName,
			WorkloadKey:              svc.WorkloadKey,
			Namespace:                svc.Namespace,
			LanguageRuntime:          svc.LanguageRuntime,
			LLMProviders:             svc.LLMProviders,
			OpenPorts:                svc.OpenPorts,
			DeploymentName:           svc.DeploymentName,
			PID:                      svc.PID,
			ExePath:                  svc.ExePath,
			InstrumentationStatus:    svc.InstrumentationStatus,
			AgentObservabilityStatus: svc.AgentObservabilityStatus,
			AgentObservabilitySource: svc.AgentObservabilitySource,
			ObservabilityConflict:    svc.ObservabilityConflict,
			ObservabilityReason:      svc.ObservabilityReason,
			FirstSeen:                svc.FirstSeen.UTC().Format("2006-01-02 15:04:05"),
			ResourceAttributes:       svc.ResourceAttributes,
		})
	}

	resp, err := client.Poll(&openlit.PollRequest{
		InstanceID:           instanceID,
		ClusterID:            clusterID,
		Version:              server.Version,
		Mode:                 mode,
		NodeName:             nodeName,
		ServicesDiscovered:   discovered,
		ServicesInstrumented: instrumented,
		Services:             dsvcs,
		ActionResults:        actionResults,
		ResourceAttributes:   controllerAttrs,
		ConfigHash:           configHash,
	})
	if err != nil {
		logger.Warn("poll failed", zap.Error(err))
		return nil
	}

	var results []openlit.ActionResult
	for _, action := range resp.Actions {
		result := executeAction(eng, action, logger)
		results = append(results, result)
	}

	pr := &pollResult{actionResults: results}

	if resp.ConfigHash != "" {
		pr.configHash = resp.ConfigHash
	}

	if resp.ConfigChanged && resp.Config != nil {
		if v, ok := resp.Config["poll_interval_seconds"]; ok {
			if seconds, ok := v.(float64); ok && seconds >= 5 && seconds <= 300 {
				pr.pollInterval = time.Duration(seconds) * time.Second
			}
		}
	}

	return pr
}

func executeAction(eng *engine.Engine, action openlit.PendingAction, logger *zap.Logger) openlit.ActionResult {
	var execErr error

	switch action.ActionType {
	case openlit.ActionInstrument:
		execErr = eng.InstrumentService(action.ServiceKey)
	case openlit.ActionUninstrument:
		execErr = eng.UninstrumentService(action.ServiceKey)
	case openlit.ActionEnablePythonSDK:
		payload, err := parsePythonSDKPayload(action.Payload)
		if err != nil {
			execErr = err
			break
		}
		execErr = eng.EnablePythonSDK(action.ServiceKey, payload)
	case openlit.ActionDisablePythonSDK:
		payload, err := parsePythonSDKPayload(action.Payload)
		if err != nil {
			execErr = err
			break
		}
		execErr = eng.DisablePythonSDK(action.ServiceKey, payload)
	default:
		logger.Warn("unknown action type", zap.String("type", action.ActionType))
		return openlit.ActionResult{
			ActionID: action.ID,
			Status:   "failed",
			Error:    fmt.Sprintf("unknown action type: %s", action.ActionType),
		}
	}

	if execErr != nil {
		logger.Error("action execution failed",
			zap.String("action_id", action.ID),
			zap.String("type", action.ActionType),
			zap.Error(execErr),
		)
		return openlit.ActionResult{
			ActionID: action.ID,
			Status:   "failed",
			Error:    execErr.Error(),
		}
	}

	logger.Info("action executed",
		zap.String("action_id", action.ID),
		zap.String("type", action.ActionType),
		zap.String("service", action.ServiceKey),
	)
	return openlit.ActionResult{
		ActionID: action.ID,
		Status:   "completed",
	}
}

func parsePythonSDKPayload(raw string) (openlit.PythonSDKActionPayload, error) {
	payload := openlit.PythonSDKActionPayload{
		TargetRuntime:          "python",
		InstrumentationProfile: "controller_managed",
		DuplicatePolicy:        "block_if_existing_otel_detected",
		ObservabilityScope:     "agent",
	}
	if raw == "" || raw == "{}" {
		return payload, nil
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return payload, fmt.Errorf("parse python SDK payload: %w", err)
	}
	if payload.TargetRuntime == "" {
		payload.TargetRuntime = "python"
	}
	if payload.InstrumentationProfile == "" {
		payload.InstrumentationProfile = "controller_managed"
	}
	if payload.DuplicatePolicy == "" {
		payload.DuplicatePolicy = "block_if_existing_otel_detected"
	}
	if payload.ObservabilityScope == "" {
		payload.ObservabilityScope = "agent"
	}
	return payload, nil
}

func buildControllerResourceAttrs(mode openlit.ControllerMode, environment string, capabilities []string) map[string]string {
	hostname, _ := os.Hostname()
	attrs := map[string]string{
		"host.name":               hostname,
		"os.type":                 runtime.GOOS,
		"host.arch":               runtime.GOARCH,
		"controller.version":      server.Version,
		"deployment.environment":  environment,
		"controller.capabilities": strings.Join(capabilities, ","),
	}

	switch mode {
	case openlit.ModeKubernetes:
		if v := os.Getenv("NODE_NAME"); v != "" {
			attrs["k8s.node.name"] = v
		}
		if v := os.Getenv("POD_NAME"); v != "" {
			attrs["k8s.pod.name"] = v
		}
		if v := os.Getenv("POD_NAMESPACE"); v != "" {
			attrs["k8s.namespace.name"] = v
		}
		if v := os.Getenv("POD_UID"); v != "" {
			attrs["k8s.pod.uid"] = v
		}
	case openlit.ModeDocker:
		attrs["container.runtime"] = "docker"
	}

	return attrs
}

func instanceID(mode openlit.ControllerMode) string {
	if env := os.Getenv("OPENLIT_INSTANCE_ID"); env != "" {
		return env
	}
	if mode == openlit.ModeKubernetes {
		if nodeName := os.Getenv("NODE_NAME"); nodeName != "" {
			return nodeName
		}
	}
	if mode == openlit.ModeDocker {
		if h, err := dockerStableID(); err == nil && h != "" {
			return h
		}
	}
	hostname, _ := os.Hostname()
	return hostname
}

func dockerStableID() (string, error) {
	hostName, err := dockerHostHostname()
	if err != nil {
		hostName, err = procHostHostname()
	}
	if err != nil || hostName == "" {
		return "", fmt.Errorf("could not determine host hostname: %w", err)
	}
	containerHostname, _ := os.Hostname()
	if containerHostname != "" && containerHostname != hostName {
		h := sha256.Sum256([]byte(containerHostname))
		hostName = hostName + "-" + hex.EncodeToString(h[:])[:6]
	}
	return hostName, nil
}

// dockerHostHostname queries the Docker Engine API for the real host hostname.
func dockerHostHostname() (string, error) {
	const sock = "/var/run/docker.sock"
	if _, err := os.Stat(sock); err != nil {
		return "", err
	}
	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
				return net.DialTimeout("unix", sock, 2*time.Second)
			},
		},
		Timeout: 5 * time.Second,
	}
	resp, err := client.Get("http://docker/info")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var info struct {
		Name string `json:"Name"`
	}
	if err := json.Unmarshal(body, &info); err != nil {
		return "", err
	}
	if info.Name == "" {
		return "", fmt.Errorf("empty Name in docker info")
	}
	return info.Name, nil
}

// procHostHostname reads the host hostname from the mounted /proc filesystem.
func procHostHostname() (string, error) {
	procRoot := os.Getenv("OPENLIT_PROC_ROOT")
	if procRoot == "" {
		procRoot = "/proc"
	}
	data, err := os.ReadFile(filepath.Join(procRoot, "sys/kernel/hostname"))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}
