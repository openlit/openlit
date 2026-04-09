package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
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
	defer logger.Sync()

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

	eng := engine.New(logger, cfg.OBIBinaryPath, cfg.OTLPEndpoint, cfg.ProcRoot, cfg.Environment)
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
	go func() {
		if err := srv.Start(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("REST API server failed", zap.Error(err))
		}
	}()

	go runPollLoop(ctx, client, eng, logger, cfg.PollInterval, nodeName, mode)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	logger.Info("shutting down")
	eng.Stop()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	srv.Shutdown(shutdownCtx)
}

func runPollLoop(
	ctx context.Context,
	client *openlit.Client,
	eng *engine.Engine,
	logger *zap.Logger,
	interval time.Duration,
	nodeName string,
	mode openlit.ControllerMode,
) {
	iid := instanceID()

	poll(ctx, client, eng, logger, iid, nodeName, mode, nil)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	var pendingResults []openlit.ActionResult

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			results := poll(ctx, client, eng, logger, iid, nodeName, mode, pendingResults)
			pendingResults = results
		}
	}
}

func poll(
	_ context.Context,
	client *openlit.Client,
	eng *engine.Engine,
	logger *zap.Logger,
	instanceID string,
	nodeName string,
	mode openlit.ControllerMode,
	actionResults []openlit.ActionResult,
) []openlit.ActionResult {
	discovered, instrumented := eng.ServiceCount()

	services := eng.GetServices()
	dsvcs := make([]openlit.DiscoveredService, 0, len(services))
	for _, svc := range services {
		dsvcs = append(dsvcs, openlit.DiscoveredService{
			ServiceName:           svc.ServiceName,
			Namespace:             svc.Namespace,
			LanguageRuntime:       svc.LanguageRuntime,
			LLMProviders:          svc.LLMProviders,
			OpenPorts:             svc.OpenPorts,
			DeploymentName:        svc.DeploymentName,
			PID:                   svc.PID,
			ExePath:               svc.ExePath,
			InstrumentationStatus: svc.InstrumentationStatus,
		})
	}

	resp, err := client.Poll(&openlit.PollRequest{
		InstanceID:           instanceID,
		Version:              server.Version,
		Mode:                 mode,
		NodeName:             nodeName,
		ServicesDiscovered:   discovered,
		ServicesInstrumented: instrumented,
		Services:             dsvcs,
		ActionResults:        actionResults,
	})
	if err != nil {
		logger.Debug("poll failed", zap.Error(err))
		return nil
	}

	var results []openlit.ActionResult
	for _, action := range resp.Actions {
		result := executeAction(eng, action, logger)
		results = append(results, result)
	}

	return results
}

func executeAction(eng *engine.Engine, action openlit.PendingAction, logger *zap.Logger) openlit.ActionResult {
	var execErr error

	switch action.ActionType {
	case "instrument":
		execErr = eng.InstrumentService(action.ServiceKey)
	case "uninstrument":
		execErr = eng.UninstrumentService(action.ServiceKey)
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

func instanceID() string {
	hostname, _ := os.Hostname()
	return fmt.Sprintf("%s-%d", hostname, os.Getpid())
}
