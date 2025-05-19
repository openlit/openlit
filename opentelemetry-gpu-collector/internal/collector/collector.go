package collector

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc"
	"go.opentelemetry.io/otel/log"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/openlit/opentelemetry-gpu-collector/config"
	"github.com/openlit/opentelemetry-gpu-collector/internal/kubernetes"
	"github.com/openlit/opentelemetry-gpu-collector/internal/profiler"
	"github.com/openlit/opentelemetry-gpu-collector/internal/rate"
	"github.com/openlit/opentelemetry-gpu-collector/internal/server"
)

// Collector manages GPU profiling and metric collection
type Collector struct {
	config       *config.Config
	logger       *zap.Logger
	otlpLogger   log.Logger
	profilers    []profiler.Profiler
	metrics      map[string]metric.Float64ObservableGauge
	eventMonitor *profiler.EventMonitor
	shutdownCh   chan struct{}
	wg           sync.WaitGroup
	k8sClient    *kubernetes.Client
	batchSize    int
	metricBatch  []metricData
	mu           sync.Mutex
	health       struct {
		mu            sync.RWMutex
		lastSuccess   time.Time
		errorCount    int
		lastError     error
		isInitialized bool
	}
	rateLimiter *rate.Limiter
	metricCache map[string]metricCacheEntry
	httpServer  *server.Server
}

type metricData struct {
	name      string
	value     float64
	attrs     []attribute.KeyValue
	timestamp time.Time
}

type metricCacheEntry struct {
	value     float64
	timestamp time.Time
	attrs     []attribute.KeyValue
}

// HealthStatus represents the current health status of the collector
type HealthStatus struct {
	Status        string    `json:"status"`
	LastSuccess   time.Time `json:"last_success"`
	ErrorCount    int       `json:"error_count"`
	LastError     string    `json:"last_error,omitempty"`
	IsInitialized bool      `json:"is_initialized"`
	GPUCount      int       `json:"gpu_count"`
	MetricCount   int       `json:"metric_count"`
}

// GetHealthStatus returns the current health status of the collector
func (c *Collector) GetHealthStatus() HealthStatus {
	c.health.mu.RLock()
	defer c.health.mu.RUnlock()

	status := "healthy"
	if !c.health.isInitialized {
		status = "initializing"
	} else if c.health.errorCount > 0 {
		status = "degraded"
	}

	return HealthStatus{
		Status:        status,
		LastSuccess:   c.health.lastSuccess,
		ErrorCount:    c.health.errorCount,
		LastError:     c.health.lastError.Error(),
		IsInitialized: c.health.isInitialized,
		GPUCount:      c.getTotalGPUCount(),
		MetricCount:   len(c.metricBatch),
	}
}

// getTotalGPUCount returns the total number of GPUs across all profilers
func (c *Collector) getTotalGPUCount() int {
	total := 0
	for _, p := range c.profilers {
		total += p.GetGPUCount()
	}
	return total
}

// updateHealthStatus updates the health status of the collector
func (c *Collector) updateHealthStatus(err error) {
	c.health.mu.Lock()
	defer c.health.mu.Unlock()

	if err != nil {
		c.health.errorCount++
		c.health.lastError = err
	} else {
		c.health.lastSuccess = time.Now()
		c.health.errorCount = 0
		c.health.lastError = nil
	}
}

// NewCollector creates a new GPU collector
func NewCollector(cfg *config.Config, logger *zap.Logger) *Collector {
	batchSize := getEnvOrDefaultInt("GPU_BATCH_SIZE", profiler.DefaultBatchSize)
	if batchSize > profiler.MaxBatchSize {
		batchSize = profiler.MaxBatchSize
	}

	// Configure rate limiter
	rateLimit := getEnvOrDefaultFloat("GPU_RATE_LIMIT", 100.0) // metrics per second
	rateLimiter := rate.NewLimiter(rate.Limit(rateLimit), int(rateLimit))

	return &Collector{
		config:       cfg,
		logger:       logger,
		profilers:    make([]profiler.Profiler, 0),
		metrics:      make(map[string]metric.Float64ObservableGauge),
		eventMonitor: profiler.NewEventMonitor(logger),
		shutdownCh:   make(chan struct{}),
		batchSize:    batchSize,
		metricBatch:  make([]metricData, 0, 1000),
		rateLimiter:  rateLimiter,
		metricCache:  make(map[string]metricCacheEntry),
	}
}

// createLogger creates a new logger with JSON format
func createLogger() (*zap.Logger, error) {
	// Get log level from environment
	logLevel := strings.ToLower(getEnvOrDefault("LOG_LEVEL", "info"))
	level := zapcore.InfoLevel
	switch logLevel {
	case "debug":
		level = zapcore.DebugLevel
	case "info":
		level = zapcore.InfoLevel
	case "warn":
		level = zapcore.WarnLevel
	case "error":
		level = zapcore.ErrorLevel
	}

	// Configure JSON encoder
	encoderConfig := zapcore.EncoderConfig{
		TimeKey:        "timestamp",
		LevelKey:       "level",
		NameKey:        "logger",
		CallerKey:      "caller",
		MessageKey:     "msg",
		StacktraceKey:  "stacktrace",
		LineEnding:     zapcore.DefaultLineEnding,
		EncodeLevel:    zapcore.LowercaseLevelEncoder,
		EncodeTime:     zapcore.ISO8601TimeEncoder,
		EncodeDuration: zapcore.SecondsDurationEncoder,
		EncodeCaller:   zapcore.ShortCallerEncoder,
	}

	// Create core
	core := zapcore.NewCore(
		zapcore.NewJSONEncoder(encoderConfig),
		zapcore.AddSync(os.Stdout),
		level,
	)

	// Create logger
	logger := zap.New(core, zap.AddCaller(), zap.AddStacktrace(zapcore.ErrorLevel))
	return logger, nil
}

// getEnvOrDefault gets an environment variable or returns a default value
func getEnvOrDefault(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

// getEnvOrDefaultInt gets an environment variable as int or returns a default value
func getEnvOrDefaultInt(key string, defaultValue int) int {
	if value, exists := os.LookupEnv(key); exists {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

// getEnvOrDefaultBool gets an environment variable as bool or returns a default value
func getEnvOrDefaultBool(key string, defaultValue bool) bool {
	if value, exists := os.LookupEnv(key); exists {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}

// getEnvOrDefaultDuration gets an environment variable as duration or returns a default value
func getEnvOrDefaultDuration(key string, defaultValue time.Duration) time.Duration {
	if value, exists := os.LookupEnv(key); exists {
		if duration, err := time.ParseDuration(value); err == nil {
			return duration
		}
	}
	return defaultValue
}

// getEnvOrDefaultFloat gets an environment variable as float64 or returns a default value
func getEnvOrDefaultFloat(key string, defaultValue float64) float64 {
	if value, exists := os.LookupEnv(key); exists {
		if floatValue, err := strconv.ParseFloat(value, 64); err == nil {
			return floatValue
		}
	}
	return defaultValue
}

// checkHealth performs a comprehensive health check
func (c *Collector) checkHealth() error {
	// Check profilers
	for _, p := range c.profilers {
		if err := p.HealthCheck(); err != nil {
			return fmt.Errorf("profiler health check failed: %w", err)
		}
	}

	// Check OpenTelemetry connection
	if err := c.checkOpenTelemetryHealth(); err != nil {
		return fmt.Errorf("OpenTelemetry health check failed: %w", err)
	}

	// Check Kubernetes client if enabled
	if c.config.Kubernetes.Enabled && c.k8sClient != nil {
		if err := c.k8sClient.HealthCheck(); err != nil {
			return fmt.Errorf("Kubernetes health check failed: %w", err)
		}
	}

	// Check event monitor
	if err := c.eventMonitor.HealthCheck(); err != nil {
		return fmt.Errorf("event monitor health check failed: %w", err)
	}

	return nil
}

// checkOpenTelemetryHealth checks OpenTelemetry connection health
func (c *Collector) checkOpenTelemetryHealth() error {
	// Check metric exporter
	if err := c.metricExporter.ForceFlush(context.Background()); err != nil {
		return fmt.Errorf("metric exporter health check failed: %w", err)
	}

	// Check log exporter
	if err := c.logExporter.ForceFlush(context.Background()); err != nil {
		return fmt.Errorf("log exporter health check failed: %w", err)
	}

	return nil
}

// Start starts the collector
func (c *Collector) Start() error {
	c.logger.Info("Starting GPU collector",
		zap.String("version", c.version),
		zap.String("commit", c.commit),
		zap.String("build_time", c.buildTime))

	// Initialize OpenTelemetry
	if err := c.initializeOpenTelemetry(); err != nil {
		return fmt.Errorf("failed to initialize OpenTelemetry: %w", err)
	}

	// Initialize Kubernetes client if enabled
	if c.config.Kubernetes.Enabled {
		client, err := kubernetes.NewClient(c.config.Kubernetes)
		if err != nil {
			return fmt.Errorf("failed to create Kubernetes client: %w", err)
		}
		c.k8sClient = client
		c.logger.Info("Kubernetes client initialized",
			zap.String("node_name", client.GetNodeName()))
	}

	// Initialize profilers
	if err := c.initializeProfilers(); err != nil {
		return fmt.Errorf("failed to initialize profilers: %w", err)
	}

	// Start event monitor
	if err := c.eventMonitor.Start(); err != nil {
		return fmt.Errorf("failed to start event monitor: %w", err)
	}

	// Start health check server
	go c.startHealthCheckServer()

	// Start collection loop
	go c.collectionLoop()

	// Start event processing loop
	go c.eventProcessingLoop()

	// Start metric export loop
	go c.metricExportLoop()

	// Perform initial health check
	if err := c.checkHealth(); err != nil {
		c.logger.Error("Initial health check failed", zap.Error(err))
		return fmt.Errorf("initial health check failed: %w", err)
	}

	c.logger.Info("GPU collector started successfully")
	return nil
}

// Stop stops the collector
func (c *Collector) Stop() error {
	close(c.shutdownCh)
	c.wg.Wait()

	// Stop HTTP server
	if c.httpServer != nil {
		if err := c.httpServer.Stop(); err != nil {
			c.logger.Warn("Failed to stop HTTP server", zap.Error(err))
		}
	}

	// Stop profilers
	for _, p := range c.profilers {
		if err := p.Stop(); err != nil {
			c.logger.Warn("Failed to stop profiler", zap.Error(err))
		}
	}

	// Stop event monitor
	if err := c.eventMonitor.Stop(); err != nil {
		c.logger.Warn("Failed to stop event monitor", zap.Error(err))
	}

	return nil
}

// initializeProfilers initializes all available GPU profilers
func (c *Collector) initializeProfilers() error {
	// Try NVIDIA profiler
	nvidiaProfiler := profiler.NewNVIDIAProfiler(c.logger, c.config.GPU.MaxSamples)
	if err := nvidiaProfiler.Init(); err == nil && nvidiaProfiler.GetGPUCount() > 0 {
		c.profilers = append(c.profilers, nvidiaProfiler)
		c.logger.Info("Initialized NVIDIA GPU profiler", zap.Int("gpu_count", nvidiaProfiler.GetGPUCount()))
	}

	// Try AMD profiler
	amdProfiler := profiler.NewAMDProfiler(c.logger, c.config.GPU.MaxSamples)
	if err := amdProfiler.Init(); err == nil && amdProfiler.GetGPUCount() > 0 {
		c.profilers = append(c.profilers, amdProfiler)
		c.logger.Info("Initialized AMD GPU profiler", zap.Int("gpu_count", amdProfiler.GetGPUCount()))
	}

	if len(c.profilers) == 0 {
		c.logger.Warn("No GPU profilers initialized")
	}

	return nil
}

// initializeOpenTelemetry initializes OpenTelemetry
func (c *Collector) initializeOpenTelemetry(ctx context.Context) error {
	// Get OTLP headers from environment
	headers := make(map[string]string)
	if headerStr := getEnvOrDefault("OTEL_EXPORTER_OTLP_HEADERS", ""); headerStr != "" {
		for _, pair := range strings.Split(headerStr, ",") {
			kv := strings.SplitN(pair, "=", 2)
			if len(kv) == 2 {
				headers[kv[0]] = kv[1]
			}
		}
	}

	// Create resource attributes
	attrs := []attribute.KeyValue{
		semconv.ServiceName(getEnvOrDefault("OTEL_SERVICE_NAME", "gpu-collector")),
		semconv.ServiceVersion(getEnvOrDefault("OTEL_SERVICE_VERSION", "1.0.0")),
	}

	// Add Kubernetes attributes if enabled
	if c.config.Kubernetes.Enabled && c.k8sClient != nil {
		attrs = append(attrs,
			attribute.String("k8s.node.name", c.k8sClient.GetNodeName()),
		)
	}

	// Create resource
	res, err := resource.New(ctx, resource.WithAttributes(attrs...))
	if err != nil {
		return fmt.Errorf("failed to create resource: %w", err)
	}

	// Create OTLP exporters
	metricExporter, err := otlpmetricgrpc.New(ctx,
		otlpmetricgrpc.WithEndpoint(getEnvOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", c.config.Export.OTLPEndpoint)),
		otlpmetricgrpc.WithInsecure(getEnvOrDefaultBool("OTEL_EXPORTER_OTLP_INSECURE", c.config.Export.Insecure)),
		otlpmetricgrpc.WithHeaders(headers),
	)
	if err != nil {
		return fmt.Errorf("failed to create metric exporter: %w", err)
	}

	logExporter, err := otlploggrpc.New(ctx,
		otlploggrpc.WithEndpoint(getEnvOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", c.config.Export.OTLPEndpoint)),
		otlploggrpc.WithInsecure(getEnvOrDefaultBool("OTEL_EXPORTER_OTLP_INSECURE", c.config.Export.Insecure)),
		otlploggrpc.WithHeaders(headers),
	)
	if err != nil {
		return fmt.Errorf("failed to create log exporter: %w", err)
	}

	// Create meter provider with batching
	meterProvider := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(
			metricExporter,
			sdkmetric.WithInterval(getEnvOrDefaultDuration("OTEL_METRIC_EXPORT_INTERVAL", 10*time.Second)),
			sdkmetric.WithTimeout(getEnvOrDefaultDuration("OTEL_METRIC_EXPORT_TIMEOUT", 5*time.Second)),
		)),
		sdkmetric.WithResource(res),
	)
	otel.SetMeterProvider(meterProvider)

	// Create logger provider
	loggerProvider := sdklog.NewLoggerProvider(
		sdklog.WithBatcher(logExporter),
		sdklog.WithResource(res),
	)
	otel.SetLoggerProvider(loggerProvider)

	// Create logger
	c.otlpLogger = otel.GetLoggerProvider().Logger(
		"gpu.collector",
		log.WithAttributes(attrs...),
	)

	// Create metrics
	meter := meterProvider.Meter("gpu.collector")

	// Create observable gauges for each metric
	for _, metricName := range []string{
		profiler.MetricGPUUtilization,
		profiler.MetricGPUTemperature,
		profiler.MetricGPUPowerUsage,
		profiler.MetricGPUMemoryUsed,
		profiler.MetricGPUMemoryTotal,
		profiler.MetricGPUMemoryFree,
		profiler.MetricGPUFanSpeed,
		profiler.MetricGPUComputeMode,
		profiler.MetricGPUEncoderUtil,
		profiler.MetricGPUDecoderUtil,
		profiler.MetricGPUMemoryUtil,
		profiler.MetricGPUPowerLimit,
		profiler.MetricGPUPowerDraw,
		profiler.MetricGPUPowerEfficiency,
	} {
		gauge, err := meter.Float64ObservableGauge(metricName)
		if err != nil {
			return fmt.Errorf("failed to create gauge for %s: %w", metricName, err)
		}
		c.metrics[metricName] = gauge
	}

	return nil
}

// collectionLoop runs the main collection loop
func (c *Collector) collectionLoop() {
	defer c.wg.Done()

	interval := getEnvOrDefaultDuration("COLLECTION_INTERVAL", c.config.CollectionInterval)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	retryCount := getEnvOrDefaultInt("ERROR_RETRY_COUNT", 3)
	retryDelay := getEnvOrDefaultDuration("ERROR_RETRY_DELAY", 5*time.Second)

	for {
		select {
		case <-c.shutdownCh:
			// Force final export before shutdown
			if err := c.collectAndExportMetrics(); err != nil {
				c.logger.Error("Failed to perform final metric export", zap.Error(err))
			}
			return
		case <-ticker.C:
			// Collect metrics with retry
			for i := 0; i < retryCount; i++ {
				if err := c.collectAndExportMetrics(); err != nil {
					c.logger.Error("Failed to collect metrics",
						zap.Error(err),
						zap.Int("attempt", i+1),
						zap.Int("max_attempts", retryCount),
					)
					if i < retryCount-1 {
						time.Sleep(retryDelay)
						continue
					}
				}
				break
			}
		}
	}
}

// collectAndExportMetrics collects and immediately exports metrics
func (c *Collector) collectAndExportMetrics() error {
	c.logger.Info("Starting metric collection cycle",
		zap.Int("profiler_count", len(c.profilers)),
		zap.Int("batch_size", c.batchSize))

	startTime := time.Now()
	if err := c.collectMetrics(); err != nil {
		c.logger.Error("Failed to collect metrics",
			zap.Error(err),
			zap.Duration("duration", time.Since(startTime)))
		c.updateHealthStatus(err)
		return err
	}

	exportStart := time.Now()
	if err := c.exportMetrics(); err != nil {
		c.logger.Error("Failed to export metrics",
			zap.Error(err),
			zap.Duration("collection_duration", time.Since(startTime)),
			zap.Duration("export_duration", time.Since(exportStart)))
		c.updateHealthStatus(err)
		return err
	}

	c.logger.Info("Completed metric collection cycle",
		zap.Duration("total_duration", time.Since(startTime)),
		zap.Duration("collection_duration", exportStart.Sub(startTime)),
		zap.Duration("export_duration", time.Since(exportStart)),
		zap.Int("metric_count", len(c.metricBatch)))

	c.updateHealthStatus(nil)
	return nil
}

// recordMetric records a metric with rate limiting and caching
func (c *Collector) recordMetric(name string, value float64, profile *profiler.GPUProfile, attrs []attribute.KeyValue) {
	// Check cache for duplicate metrics
	cacheKey := fmt.Sprintf("%s_%s_%d", name, profile.GPUType, profile.GPUIndex)
	if cached, exists := c.metricCache[cacheKey]; exists {
		// Only update if value changed or cache expired
		if cached.value != value || time.Since(cached.timestamp) > 5*time.Second {
			// Wait for rate limiter
			if err := c.rateLimiter.Wait(context.Background()); err != nil {
				c.logger.Warn("Rate limiter error", zap.Error(err))
			}

			// Add to metric batch
			c.mu.Lock()
			c.metricBatch = append(c.metricBatch, metricData{
				name:      name,
				value:     value,
				attrs:     attrs,
				timestamp: profile.Timestamp,
			})
			c.mu.Unlock()

			// Update cache
			c.metricCache[cacheKey] = metricCacheEntry{
				value:     value,
				timestamp: profile.Timestamp,
				attrs:     attrs,
			}

			// Log metric as OpenTelemetry log
			c.logMetric(name, value, profile, attrs)
		}
	} else {
		// New metric, add to batch and cache
		if err := c.rateLimiter.Wait(context.Background()); err != nil {
			c.logger.Warn("Rate limiter error", zap.Error(err))
		}

		c.mu.Lock()
		c.metricBatch = append(c.metricBatch, metricData{
			name:      name,
			value:     value,
			attrs:     attrs,
			timestamp: profile.Timestamp,
		})
		c.mu.Unlock()

		c.metricCache[cacheKey] = metricCacheEntry{
			value:     value,
			timestamp: profile.Timestamp,
			attrs:     attrs,
		}

		c.logMetric(name, value, profile, attrs)
	}
}

// collectMetrics collects metrics from all profilers
func (c *Collector) collectMetrics() error {
	// Get pod information if Kubernetes is enabled
	var podsWithGPU []kubernetes.PodInfo
	if c.config.Kubernetes.Enabled && c.k8sClient != nil {
		var err error
		podsWithGPU, err = c.k8sClient.GetPodsWithGPU(context.Background())
		if err != nil {
			c.logger.Error("Failed to get pods with GPU",
				zap.Error(err),
				zap.String("node_name", c.k8sClient.GetNodeName()))
			return fmt.Errorf("failed to get pods with GPU: %w", err)
		}
		c.logger.Debug("Retrieved pods with GPU",
			zap.Int("pod_count", len(podsWithGPU)))
	}

	// Process profilers in batches
	for _, p := range c.profilers {
		// Get total GPU count
		totalGPUs := p.GetGPUCount()
		if totalGPUs == 0 {
			c.logger.Warn("No GPUs found for profiler",
				zap.String("gpu_type", string(p.GetGPUType())))
			continue
		}

		c.logger.Info("Processing GPU profiler",
			zap.String("gpu_type", string(p.GetGPUType())),
			zap.Int("total_gpus", totalGPUs),
			zap.Int("batch_size", c.batchSize))

		// Process GPUs in batches
		for startIndex := 0; startIndex < totalGPUs; startIndex += c.batchSize {
			endIndex := startIndex + c.batchSize
			if endIndex > totalGPUs {
				endIndex = totalGPUs
			}

			c.logger.Debug("Processing GPU batch",
				zap.String("gpu_type", string(p.GetGPUType())),
				zap.Int("start_index", startIndex),
				zap.Int("end_index", endIndex))

			// Get profiles for this batch
			profiles, err := p.GetProfiles()
			if err != nil {
				c.logger.Error("Failed to get GPU profiles",
					zap.Error(err),
					zap.String("gpu_type", string(p.GetGPUType())),
					zap.Int("start_index", startIndex),
					zap.Int("end_index", endIndex))
				continue
			}

			// Process each profile in the batch
			for _, profile := range profiles {
				if profile == nil {
					c.logger.Warn("Received nil profile",
						zap.String("gpu_type", string(p.GetGPUType())))
					continue
				}

				// Add Kubernetes information to custom labels if enabled
				if c.config.Kubernetes.Enabled && c.k8sClient != nil {
					// Add node name
					profile.CustomLabels["k8s.node.name"] = c.k8sClient.GetNodeName()

					// Add pod information if available
					for _, pod := range podsWithGPU {
						if pod.GPUIndex == profile.GPUIndex && pod.GPUType == string(profile.GPUType) {
							profile.CustomLabels["k8s.pod.name"] = pod.Name
							profile.CustomLabels["k8s.pod.namespace"] = pod.Namespace
							profile.CustomLabels["k8s.pod.uid"] = pod.UID
							c.logger.Debug("Added pod information to GPU profile",
								zap.String("pod_name", pod.Name),
								zap.String("pod_namespace", pod.Namespace),
								zap.Int("gpu_index", profile.GPUIndex))
							break
						}
					}
				}

				// Record metrics
				for name, value := range profile.Metrics {
					if gauge, ok := c.metrics[name]; ok {
						// Base attributes
						attrs := []attribute.KeyValue{
							attribute.String("gpu.type", string(profile.GPUType)),
							attribute.Int("gpu.index", profile.GPUIndex),
							attribute.String("gpu.name", profile.GPUName),
							attribute.String("gpu.driver_version", profile.DriverVersion),
						}

						// Add custom labels
						for k, v := range profile.CustomLabels {
							attrs = append(attrs, attribute.String(k, v))
						}

						// Record metric
						c.recordMetric(name, value, profile, attrs)
					}
				}

				// Record profiling metrics if enabled
				if c.config.GPU.EnableProfiling {
					for name, value := range profile.ProfilingMetrics {
						c.logProfilingMetric(name, value, profile)
					}
				}

				// Record process information
				for _, proc := range profile.ProcessInfo {
					c.logProcess(proc, profile)
				}
			}
		}
	}

	return nil
}

// exportMetrics exports the batched metrics to OpenTelemetry
func (c *Collector) exportMetrics() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.metricBatch) == 0 {
		c.logger.Debug("No metrics to export")
		return nil
	}

	c.logger.Info("Exporting metrics",
		zap.Int("metric_count", len(c.metricBatch)))

	// Group metrics by name for efficient export
	metricGroups := make(map[string][]metricData)
	for _, m := range c.metricBatch {
		metricGroups[m.name] = append(metricGroups[m.name], m)
	}

	// Export each group of metrics
	for name, metrics := range metricGroups {
		if gauge, ok := c.metrics[name]; ok {
			for _, m := range metrics {
				gauge.Record(m.value, m.attrs...)
			}
			c.logger.Debug("Exported metric group",
				zap.String("metric_name", name),
				zap.Int("metric_count", len(metrics)))
		}
	}

	// Clear the batch
	c.metricBatch = c.metricBatch[:0]
	c.logger.Debug("Cleared metric batch")
	return nil
}

// eventProcessingLoop processes GPU events and converts them to OpenTelemetry events
func (c *Collector) eventProcessingLoop(ctx context.Context) {
	defer c.wg.Done()

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.shutdownCh:
			return
		case event, ok := <-c.eventMonitor.GetEvents():
			if !ok {
				return
			}

			// Log event
			c.logEvent(event)
		}
	}
}

// logEvent logs a GPU event using OpenTelemetry logging
func (c *Collector) logEvent(event profiler.GPUEvent) {
	attrs := []log.KeyValue{
		log.String("event.type", event.EventType),
		log.String("gpu.type", string(event.GPUType)),
		log.Int("gpu.index", event.GPUIndex),
		log.Float64("event.value", event.Value),
		log.Time("timestamp", event.Timestamp),
	}

	// Add process information if available
	if event.ProcessID > 0 {
		attrs = append(attrs,
			log.Int("process.id", event.ProcessID),
			log.String("process.name", event.ProcessName),
		)
	}

	// Add Kubernetes attributes if enabled
	if c.config.Kubernetes.Enabled && c.k8sClient != nil {
		attrs = append(attrs,
			log.String("k8s.node.name", c.k8sClient.GetNodeName()),
		)
	}

	// Add custom attributes
	for k, v := range event.Attributes {
		attrs = append(attrs, log.String(k, v))
	}

	// Log event
	c.otlpLogger.Info("GPU event", attrs...)
}

// logMetric logs a metric using OpenTelemetry logging
func (c *Collector) logMetric(name string, value float64, profile *profiler.GPUProfile, attrs []attribute.KeyValue) {
	c.otlpLogger.Info("GPU metric",
		log.String("metric.name", name),
		log.Float64("metric.value", value),
		log.String("gpu.type", string(profile.GPUType)),
		log.Int("gpu.index", profile.GPUIndex),
		log.String("gpu.name", profile.GPUName),
		log.Time("timestamp", profile.Timestamp),
	)
}

// logProcess logs process information using OpenTelemetry logging
func (c *Collector) logProcess(proc profiler.ProcessInfo, profile *profiler.GPUProfile) {
	c.otlpLogger.Info("GPU process",
		log.Int("process.id", proc.PID),
		log.String("process.name", proc.Name),
		log.Int64("process.memory_usage", proc.MemoryUsage),
		log.Float64("process.gpu_util", proc.GPUUtil),
		log.Time("process.start_time", proc.StartTime),
		log.String("gpu.type", string(profile.GPUType)),
		log.Int("gpu.index", profile.GPUIndex),
	)
}

// logProfilingMetric logs a profiling metric using OpenTelemetry logging
func (c *Collector) logProfilingMetric(name string, value interface{}, profile *profiler.GPUProfile) {
	c.otlpLogger.Debug("GPU profiling metric",
		log.String("metric.name", name),
		log.Any("metric.value", value),
		log.String("gpu.type", string(profile.GPUType)),
		log.Int("gpu.index", profile.GPUIndex),
		log.Time("timestamp", profile.Timestamp),
	)
}

// logError logs an error with context using OpenTelemetry logging
func (c *Collector) logError(msg string, err error, fields ...log.Field) {
	fields = append(fields, log.Error(err))
	c.otlpLogger.Error(msg, fields...)
	c.logger.Error(msg, zap.Error(err))
}

// logInfo logs an informational message with context using OpenTelemetry logging
func (c *Collector) logInfo(msg string, fields ...log.Field) {
	c.otlpLogger.Info(msg, fields...)
	c.logger.Info(msg)
}

// logDebug logs a debug message with context using OpenTelemetry logging
func (c *Collector) logDebug(msg string, fields ...log.Field) {
	c.otlpLogger.Debug(msg, fields...)
	c.logger.Debug(msg)
}

// logWarn logs a warning message with context using OpenTelemetry logging
func (c *Collector) logWarn(msg string, fields ...log.Field) {
	c.otlpLogger.Warn(msg, fields...)
	c.logger.Warn(msg)
} 