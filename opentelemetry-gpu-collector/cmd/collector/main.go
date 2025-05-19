package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/openlit/opentelemetry-gpu-collector/config"
	"github.com/openlit/opentelemetry-gpu-collector/internal/collector"
	"go.uber.org/zap"
)

func main() {
	// Parse command line flags
	configPath := flag.String("config", "", "Path to configuration file")
	flag.Parse()

	// Create logger
	logger, err := collector.CreateLogger()
	if err != nil {
		fmt.Printf("Failed to create logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	// Load configuration
	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		logger.Fatal("Failed to load configuration",
			zap.Error(err),
			zap.String("config_path", *configPath),
		)
	}

	// Create collector
	c := collector.NewCollector(cfg, logger)

	// Create context that will be canceled on SIGINT/SIGTERM
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-sigCh
		logger.Info("Received signal, shutting down",
			zap.String("signal", sig.String()),
		)
		cancel()
	}()

	// Start collector
	logger.Info("Starting GPU collector",
		zap.String("version", os.Getenv("OTEL_SERVICE_VERSION")),
		zap.String("service_name", os.Getenv("OTEL_SERVICE_NAME")),
		zap.String("endpoint", os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")),
	)

	if err := c.Start(ctx); err != nil {
		logger.Fatal("Failed to start collector",
			zap.Error(err),
		)
	}

	// Wait for context cancellation
	<-ctx.Done()

	// Stop collector
	if err := c.Stop(); err != nil {
		logger.Error("Error stopping collector",
			zap.Error(err),
		)
		os.Exit(1)
	}

	logger.Info("Collector stopped successfully")
} 