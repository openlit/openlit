/*
OpenLIT Kubernetes Operator

This is the main entry point for the OpenLIT Kubernetes operator that provides
zero-code instrumentation for applications running in Kubernetes clusters.

The operator automatically injects OpenTelemetry instrumentation into pods
based on AutoInstrumentation Custom Resources, supporting multiple providers
including OpenLIT, OpenInference, and OpenLLMetry.

Key features:
- Automatic instrumentation injection via admission webhooks
- Support for multiple instrumentation providers
- Custom Resource-based configuration
- Comprehensive observability with OpenTelemetry structured logging
- Multi-provider environment support (OpenLIT, OpenInference, OpenLLMetry)

For more information, visit: https://github.com/openlit/openlit
*/
package main

import (
	"context"
	"fmt"
	"io/ioutil"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/cache"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/webhook"
	"sigs.k8s.io/controller-runtime/pkg/webhook/admission"

	"github.com/openlit/openlit/operator/api/v1alpha1"
	"github.com/openlit/openlit/operator/internal/config"
	"github.com/openlit/openlit/operator/internal/controller"
	"github.com/openlit/openlit/operator/internal/observability"
	openlitwebhook "github.com/openlit/openlit/operator/internal/webhook"
)

var (
	scheme = runtime.NewScheme()
)

func init() {
	_ = corev1.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)
	_ = apiextensionsv1.AddToScheme(scheme)
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Load configuration first
	cfg, err := config.GetConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load configuration: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("🐛 DEBUG: Initializing OpenTelemetry logging...\n")
	// Initialize OpenTelemetry logging
	loggerProvider, err := observability.NewLoggerProvider(
		ctx,
		cfg.SelfMonitoringEnabled,
		cfg.OTLPEndpoint,
		cfg.OTLPLogsEndpoint,
		"openlit-operator",
		"1.0.0",
		cfg.Namespace,
	)
	if err != nil {
		fmt.Printf("Failed to initialize OpenTelemetry logging: %v\n", err)
		os.Exit(1)
	}
	defer loggerProvider.Shutdown(ctx)
	fmt.Printf("🐛 DEBUG: OpenTelemetry logging initialized\n")

	fmt.Printf("🐛 DEBUG: Creating structured logger...\n")
	// Create structured logger
	setupLog := observability.NewLogger("setup")

	fmt.Printf("🐛 DEBUG: Structured logger created, logging startup info...\n")
	setupLog.Info("🚀 Starting OpenLIT Operator",
		"service.name", "openlit-operator",
		"service.version", "1.0.0",
		"k8s.namespace.name", cfg.Namespace,
		"self_monitoring_enabled", cfg.SelfMonitoringEnabled,
		"otel.exporter.otlp.endpoint", cfg.OTLPEndpoint)

	setupLog.Info("📋 Configuration loaded",
		"k8s.namespace.name", cfg.Namespace,
		"webhook.port", cfg.WebhookPort,
		"webhook.path", cfg.WebhookPath,
		// metrics.port removed - no metrics server implemented
		"health.port", cfg.HealthPort)

	fmt.Printf("🐛 DEBUG: Creating Kubernetes client...\n")
	// Create Kubernetes client
	k8sConfig := ctrl.GetConfigOrDie()
	client, err := kubernetes.NewForConfig(k8sConfig)
	if err != nil {
		fmt.Printf("🐛 DEBUG: Failed to create Kubernetes client: %v\n", err)
		setupLog.Error("Failed to create Kubernetes client", err,
			"k8s.client.type", "kubernetes")
		os.Exit(1)
	}
	fmt.Printf("🐛 DEBUG: Kubernetes client created successfully\n")


	fmt.Printf("🐛 DEBUG: Creating webhook server...\n")
	// Create webhook server
	webhookServer := webhook.NewServer(webhook.Options{
		Port:    cfg.WebhookPort,
		CertDir: cfg.WebhookCertDir,
	})
	fmt.Printf("🐛 DEBUG: Webhook server created\n")

	// Get watch namespace from environment (empty = all namespaces)
	watchNamespace := os.Getenv("WATCH_NAMESPACE")
	if watchNamespace != "" {
		setupLog.Info("🎯 Operator scoped to specific namespace",
			"watch.namespace", watchNamespace,
			"scope.type", "namespace-scoped")
	} else {
		setupLog.Info("🌐 Operator watching all namespaces",
			"scope.type", "cluster-wide")
	}

	fmt.Printf("🐛 DEBUG: Creating controller-runtime manager...\n")
	// Create controller-runtime manager
	mgrOptions := ctrl.Options{
		Scheme:         scheme,
		LeaderElection: false,
		WebhookServer:  webhookServer,
		HealthProbeBindAddress: fmt.Sprintf(":%d", cfg.HealthPort), // Enable health probes
	}
	
	// Set namespace if watching specific namespace
	if watchNamespace != "" {
		fmt.Printf("🐛 DEBUG: Setting namespace-scoped cache for: %s\n", watchNamespace)
		mgrOptions.Cache = cache.Options{
			DefaultNamespaces: map[string]cache.Config{
				watchNamespace: {},
			},
		}
	}
	
	fmt.Printf("🐛 DEBUG: About to call ctrl.NewManager...\n")
	mgr, err := ctrl.NewManager(k8sConfig, mgrOptions)
	if err != nil {
		fmt.Printf("🐛 DEBUG: Failed to create manager: %v\n", err)
		setupLog.Error("Failed to create controller manager", err,
			"controller.manager.type", "webhook")
		os.Exit(1)
	}
	fmt.Printf("🐛 DEBUG: Manager created successfully\n")

	// Use the main context

	fmt.Printf("🐛 DEBUG: Setting up TLS certificate management...\n")
	// Setup TLS certificate management
	certManager := openlitwebhook.NewCertificateManager(
		client,
		cfg.Namespace,
		cfg.ServiceName,
		cfg.SecretName,
		cfg.CertValidityDays,
		cfg.CertRefreshDays,
	)
	fmt.Printf("🐛 DEBUG: Certificate manager created\n")

	// Ensure certificates exist
	fmt.Printf("🐛 DEBUG: About to ensure certificates...\n")
	setupLog.Info("🔐 Setting up TLS certificates",
		"tls.certificate.validity_days", cfg.CertValidityDays,
		"tls.certificate.refresh_days", cfg.CertRefreshDays,
		"k8s.secret.name", cfg.SecretName)
	caCert, err := certManager.EnsureCertificate(ctx)
	if err != nil {
		fmt.Printf("🐛 DEBUG: Failed to ensure certificates: %v\n", err)
		setupLog.Error("Failed to ensure TLS certificate", err,
			"k8s.secret.name", cfg.SecretName,
			"k8s.namespace.name", cfg.Namespace)
		os.Exit(1)
	}
	fmt.Printf("🐛 DEBUG: Certificates ensured successfully\n")

	// Setup webhook configuration  
	webhookConfigManager := openlitwebhook.NewWebhookConfigManager(
		client,
		cfg.Namespace,
		cfg.ServiceName,
		cfg.ConfigName,
		cfg.WebhookPath,
		443, // Service port
		cfg.FailurePolicy,
		cfg.ReinvocationPolicy,
		observability.NewLogger("webhook-config").WithContext(ctx),
	)

	// Note: Webhook configuration will be created after the manager starts and webhook server is ready

	// Copy certificates to filesystem for webhook server
	fmt.Printf("🐛 DEBUG: About to copy certificates to filesystem...\n")
	if err := copyCertificatesToFileSystem(ctx, client, cfg.Namespace, cfg.SecretName, cfg.WebhookCertDir, setupLog); err != nil {
		fmt.Printf("🐛 DEBUG: Failed to copy certificates: %v\n", err)
		setupLog.Error("Failed to copy certificates to filesystem", err,
			"certificate.directory", cfg.WebhookCertDir,
			"k8s.secret.name", cfg.SecretName)
		os.Exit(1)
	}
	fmt.Printf("🐛 DEBUG: Certificates copied to filesystem successfully\n")

	// Create dynamic client for reading CRDs
	fmt.Printf("🐛 DEBUG: Creating dynamic client...\n")
	dynamicClient, err := dynamic.NewForConfig(k8sConfig)
	if err != nil {
		fmt.Printf("🐛 DEBUG: Failed to create dynamic client: %v\n", err)
		setupLog.Error("Failed to create dynamic client", err,
			"k8s.client.type", "dynamic")
		os.Exit(1)
	}
	fmt.Printf("🐛 DEBUG: Dynamic client created successfully\n")
	
	// Create and register webhook handler
	webhookHandler := openlitwebhook.NewHandler(cfg, scheme, dynamicClient)
	recoverPanic := true
	mgr.GetWebhookServer().Register(cfg.WebhookPath, &admission.Webhook{Handler: webhookHandler, RecoverPanic: &recoverPanic})

	// Setup AutoInstrumentation controller for management labeling and validation
	setupLog.Info("🎮 Setting up AutoInstrumentation controller")
	autoInstrReconciler := controller.NewAutoInstrumentationReconciler(mgr.GetClient(), mgr.GetScheme())
	if err := autoInstrReconciler.SetupWithManager(mgr); err != nil {
		setupLog.Error("Failed to setup AutoInstrumentation controller", err,
			"controller.type", "autoinstrumentation")
		os.Exit(1)
	}

	// Add health check endpoints
	fmt.Printf("🐛 DEBUG: Adding health check endpoints...\n")
	if err := mgr.AddHealthzCheck("healthz", healthz.Ping); err != nil {
		setupLog.Error("Failed to add healthz endpoint", err)
		os.Exit(1)
	}
	if err := mgr.AddReadyzCheck("readyz", healthz.Ping); err != nil {
		setupLog.Error("Failed to add readyz endpoint", err)
		os.Exit(1)
	}
	fmt.Printf("🐛 DEBUG: Health check endpoints added\n")

	setupLog.Info("🎯 Starting webhook server",
		"webhook.port", cfg.WebhookPort,
		"webhook.path", cfg.WebhookPath,
		"webhook.panic_recovery", recoverPanic,
		"health.port", cfg.HealthPort)

	// Handle graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan
		setupLog.Info("Received shutdown signal, gracefully shutting down")
		cancel()
	}()

	// Start the manager in a goroutine so we can setup webhook configuration after it's ready
	fmt.Printf("🐛 DEBUG: About to start controller manager...\n")
	setupLog.Info("🚀 Starting controller manager")
	
	// Start manager in background
	managerErrChan := make(chan error, 1)
	go func() {
		fmt.Printf("🐛 DEBUG: Manager goroutine starting...\n")
		managerErrChan <- mgr.Start(ctx)
	}()
	
	// Wait for manager to be ready, then setup webhook configuration
	go func() {
		// Give the webhook server a moment to start
		time.Sleep(5 * time.Second)
		
		setupLog.Info("🔧 Setting up webhook configuration",
			"k8s.mutatingwebhookconfiguration.name", cfg.ConfigName,
			"webhook.failure_policy", cfg.FailurePolicy,
			"webhook.reinvocation_policy", cfg.ReinvocationPolicy)
		if err := webhookConfigManager.EnsureWebhookConfiguration(ctx, caCert); err != nil {
			setupLog.Error("Failed to ensure webhook configuration", err,
				"k8s.mutatingwebhookconfiguration.name", cfg.ConfigName)
		} else {
			setupLog.Info("✅ Webhook configuration created successfully")
		}
	}()
	
	// Wait for manager to complete
	if err := <-managerErrChan; err != nil {
		setupLog.Error("Failed to start controller manager", err)
		os.Exit(1)
	}

	setupLog.Info("OpenLIT Operator shutdown complete")
}

func copyCertificatesToFileSystem(ctx context.Context, client kubernetes.Interface, namespace, secretName, certDir string, logger *observability.StructuredLogger) error {
	secret, err := client.CoreV1().Secrets(namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get TLS secret: %w", err)
	}

	// Ensure cert directory exists
	if err := os.MkdirAll(certDir, 0755); err != nil {
		return fmt.Errorf("failed to create cert directory: %w", err)
	}

	// Write certificate files
	tlsCrtPath := filepath.Join(certDir, "tls.crt")
	tlsKeyPath := filepath.Join(certDir, "tls.key")

	if err := ioutil.WriteFile(tlsCrtPath, secret.Data["tls.crt"], 0600); err != nil {
		return fmt.Errorf("failed to write tls.crt: %w", err)
	}

	if err := ioutil.WriteFile(tlsKeyPath, secret.Data["tls.key"], 0600); err != nil {
		return fmt.Errorf("failed to write tls.key: %w", err)
	}

	logger.Info("📋 TLS certificates copied to filesystem",
		"certificate.directory", certDir,
		"tls.certificate.file", "tls.crt",
		"tls.private_key.file", "tls.key")
	return nil
}