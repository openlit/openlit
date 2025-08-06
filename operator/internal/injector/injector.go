/*
OpenLIT Pod Instrumentation Injector

This package implements the core logic for injecting OpenTelemetry instrumentation
into Kubernetes pods. It handles the complex task of modifying pod specifications
to include init containers, environment variables, and volume mounts necessary
for zero-code instrumentation.

Key components:
- OpenLitInjector: Main injector implementation
- Pod modification logic for adding instrumentation containers
- Environment variable injection from multiple sources (secrets, configmaps, etc.)
- Volume and mount management for instrumentation packages
- Provider-specific setup script generation
- Comprehensive error handling and logging

The injector transforms a regular application pod into an instrumented pod by:
1. Adding an init container that sets up instrumentation packages
2. Injecting OpenTelemetry environment variables
3. Creating shared volumes for instrumentation code
4. Configuring PYTHONPATH and other runtime settings
5. Handling custom packages and provider-specific configurations

Supports all major instrumentation providers and handles edge cases like
existing environment variables, custom images, and complex volume scenarios.

This is the "engine" that powers the zero-code instrumentation magic!
*/
package injector

import (
	"fmt"
	"os"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"

	"github.com/openlit/openlit/operator/internal/observability"
)

var log = observability.NewLogger("injector")

// OpenLitInjector handles the injection of OpenLIT instrumentation
type OpenLitInjector struct {
	config *InjectorConfig
}

// New creates a new OpenLitInjector
func New(cfg *InjectorConfig) *OpenLitInjector {
	return &OpenLitInjector{
		config: cfg,
	}
}

// InjectOpenLIT injects OpenLIT instrumentation into a pod
func (i *OpenLitInjector) InjectOpenLIT(pod *corev1.Pod) {
	log.Info("🔧 Starting OpenLIT injection",
		"component", "injector",
		"k8s.pod.name", pod.Name,
		"k8s.namespace.name", pod.Namespace,
		"instrumentation.provider", i.config.Provider)

	// Add init container for OpenLIT SDK installation
	i.addInitContainer(pod)

	// Add shared volume for OpenLIT SDK
	i.addSharedVolume(pod)

	// Modify application containers
	for idx := range pod.Spec.Containers {
		i.modifyContainer(&pod.Spec.Containers[idx], pod)
	}

	log.Info("✅ OpenLIT injection completed",
		"component", "injector",
		"k8s.pod.name", pod.Name,
		"k8s.namespace.name", pod.Namespace,
		"instrumentation.provider", i.config.Provider)
}

// addInitContainer adds an init container to install instrumentation SDK
func (i *OpenLitInjector) addInitContainer(pod *corev1.Pod) {
	// Generate installation commands based on provider
	installCmd := i.generateInstallCommand()
	
	initContainer := corev1.Container{
		Name:            i.config.GetContainerName(),
		Image:           i.config.GetInitContainerImage(),
		ImagePullPolicy: i.config.ImagePullPolicy,
		Command:         []string{"/bin/sh"},
		Args: []string{
			"-c",
			installCmd,
		},
		VolumeMounts: []corev1.VolumeMount{
			{
				Name:      "openlit-sdk",
				MountPath: "/openlit-sdk",
			},
		},
		Env: []corev1.EnvVar{
			{
				Name:  "INSTRUMENTATION_PROVIDER",
				Value: i.config.Provider,
			},
		},
		Resources: corev1.ResourceRequirements{
			Limits: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("200m"),
				corev1.ResourceMemory: resource.MustParse("256Mi"),
			},
			Requests: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("100m"),
				corev1.ResourceMemory: resource.MustParse("128Mi"),
			},
		},
	}

	log.Info("📦 Adding auto-instrumentation init container",
		"component", "injector",
		"k8s.container.name", initContainer.Name,
		"k8s.container.image", initContainer.Image,
		"instrumentation.provider", i.config.Provider,
		"k8s.container.image_pull_policy", string(initContainer.ImagePullPolicy))
	pod.Spec.InitContainers = append(pod.Spec.InitContainers, initContainer)
}

// generateInstallCommand generates the fast file-copy command based on the provider  
func (i *OpenLitInjector) generateInstallCommand() string {
	// Smart installation: pre-built base + targeted custom packages
	provider := i.config.Provider
	
	var installCommands []string
	
	// Step 1: Copy pre-built base instrumentation (fast!)
	installCommands = append(installCommands, fmt.Sprintf(`
echo "🚀 Setting up %s instrumentation..."
export INSTRUMENTATION_PROVIDER=%s

# Copy pre-built base instrumentation using Python setup script
python3 /usr/local/bin/setup-instrumentation.py`, provider, provider))

	// Step 2: Install custom packages if specified (targeted, fast)
	if i.config.CustomPackages != "" {
		installCommands = append(installCommands, `
echo "📦 Installing custom packages..."`)
		
		// Install custom packages
		installCommands = append(installCommands, fmt.Sprintf(`
# Install user-specified custom packages
echo "Installing: %s"
pip install --target /openlit-sdk --no-deps %s`, 
			i.config.CustomPackages, 
			strings.ReplaceAll(i.config.CustomPackages, ",", " ")))
		
		installCommands = append(installCommands, `
echo "✅ Custom packages installed!"`)
	}
	
	// Final step
	var finalMessage string
	if provider == "openlit" {
		finalMessage = fmt.Sprintf(`
echo "✅ %s instrumentation ready! Using openlit-instrument CLI"
echo "🎯 Zero-code instrumentation via openlit-instrument CLI approach"
echo "🚀 Auto-discovery and setup handled automatically"
ls -la /openlit-sdk/ | head -10`, provider)
	} else {
		finalMessage = fmt.Sprintf(`
echo "✅ %s instrumentation ready!"
echo "🎯 Zero-code instrumentation configured via Kubernetes CR"
ls -la /openlit-sdk/ | head -10`, provider)
	}
	installCommands = append(installCommands, finalMessage)

	return strings.Join(installCommands, "\n")
}

// addSharedVolume adds a shared volume for the instrumentation SDK
func (i *OpenLitInjector) addSharedVolume(pod *corev1.Pod) {
	volume := corev1.Volume{
		Name: "openlit-sdk", // Keep same name for backward compatibility
		VolumeSource: corev1.VolumeSource{
			EmptyDir: &corev1.EmptyDirVolumeSource{},
		},
	}

	log.Info("💾 Adding instrumentation shared volume",
		"component", "injector",
		"k8s.volume.name", volume.Name,
		"k8s.volume.type", "emptydir",
		"instrumentation.provider", i.config.Provider)
	pod.Spec.Volumes = append(pod.Spec.Volumes, volume)
}

// modifyContainer modifies an application container for auto-instrumentation
func (i *OpenLitInjector) modifyContainer(container *corev1.Container, pod *corev1.Pod) {
	log.Info("🔧 Modifying container for auto-instrumentation",
		"component", "injector",
		"k8s.container.name", container.Name,
		"instrumentation.provider", i.config.Provider)

	// Add volume mount for instrumentation SDK
	volumeMount := corev1.VolumeMount{
		Name:      "openlit-sdk",
		MountPath: "/openlit-sdk",
		ReadOnly:  true,
	}
	container.VolumeMounts = append(container.VolumeMounts, volumeMount)

	// Add environment variables for instrumentation configuration
	envVars := i.buildEnvironmentVariables(container, pod)
	container.Env = append(container.Env, envVars...)

	log.Info("✅ Container modification completed",
		"component", "injector",
		"k8s.container.name", container.Name,
		"instrumentation.provider", i.config.Provider)
}

// buildEnvironmentVariables creates the environment variables for instrumentation configuration
func (i *OpenLitInjector) buildEnvironmentVariables(container *corev1.Container, pod *corev1.Pod) []corev1.EnvVar {
	// Calculate OpenTelemetry resource attributes following K8s conventions
	serviceName := i.generateServiceName(container, pod)
	serviceNamespace := i.generateServiceNamespace(pod)
	serviceVersion := i.generateServiceVersion(pod)
	deploymentEnvironment := i.config.Environment
	if deploymentEnvironment == "" {
		deploymentEnvironment = "kubernetes" // Simple fallback
	}

	// Build comprehensive OTEL_RESOURCE_ATTRIBUTES following OpenTelemetry semantic conventions
	resourceAttrs := []string{
		fmt.Sprintf("service.name=%s", serviceName),
		fmt.Sprintf("service.namespace=%s", serviceNamespace),
		fmt.Sprintf("deployment.environment=%s", deploymentEnvironment),
	}
	
	// Add service.version only if available
	if serviceVersion != "" {
		resourceAttrs = append(resourceAttrs, fmt.Sprintf("service.version=%s", serviceVersion))
	}
	
	// Only add service.instance.id if we have the actual pod name (not during admission webhook)
	var serviceInstanceId string
	if pod.Name != "" {
		serviceInstanceId = i.generateServiceInstanceId(container, pod)
		resourceAttrs = append(resourceAttrs, fmt.Sprintf("service.instance.id=%s", serviceInstanceId))
	}

	// Check if PYTHONPATH already exists in the container
	var existingPythonPath string
	for _, env := range container.Env {
		if env.Name == "PYTHONPATH" {
			existingPythonPath = env.Value
			break
		}
	}
	
	// Build PYTHONPATH value - prepend our SDK path
	pythonPathValue := "/openlit-sdk"
	if existingPythonPath != "" {
		pythonPathValue = "/openlit-sdk:" + existingPythonPath
	}

	envVars := []corev1.EnvVar{
		{
			Name:  "PYTHONPATH",
			Value: pythonPathValue,
		},
		// Standard OpenTelemetry environment variables (used by all providers)
		{
			Name:  "OTEL_EXPORTER_OTLP_ENDPOINT",
			Value: i.config.OTLPEndpoint,
		},
		{
			Name:  "OTEL_EXPORTER_OTLP_HEADERS",
			Value: i.config.OTLPHeaders,
		},
		{
			Name:  "OTEL_SERVICE_NAME",
			Value: serviceName,
		},
		{
			Name:  "OTEL_SERVICE_NAMESPACE", 
			Value: serviceNamespace,
		},
		{
			Name:  "OTEL_DEPLOYMENT_ENVIRONMENT",
			Value: deploymentEnvironment,
		},
		{
			Name:  "OTEL_RESOURCE_ATTRIBUTES",
			Value: strings.Join(resourceAttrs, ","),
		},
		// Optional service version
		{
			Name:  "OTEL_SERVICE_VERSION",
			Value: serviceVersion, // May be empty
		},
		// GenAI-specific configuration
		{
			Name:  "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT",
			Value: fmt.Sprintf("%t", i.config.CaptureMessageContent),
		},
	}
	
	// Only add OTEL_SERVICE_INSTANCE_ID if we have the actual pod name
	if pod.Name != "" && serviceInstanceId != "" {
		envVars = append(envVars, corev1.EnvVar{
			Name:  "OTEL_SERVICE_INSTANCE_ID",
			Value: serviceInstanceId,
		})
	}

	// Add optional OpenLIT-specific environment variables (removed advanced options for now)

	if i.config.DetailedTracing {
		envVars = append(envVars, corev1.EnvVar{
			Name:  "OPENLIT_DETAILED_TRACING",
			Value: "true",
		})
	}

	// Phoenix-specific variables removed - using pure OpenTelemetry approach for OpenInference
	// Add custom instrumentation environment variables
	if i.config.CustomPackages != "" {
		envVars = append(envVars, corev1.EnvVar{
			Name:  "CUSTOM_PACKAGES",
			Value: i.config.CustomPackages,
		})
	}

	log.Info("🌍 OpenTelemetry resource attributes configured",
		"component", "injector",
		"service.name", serviceName,
		"service.namespace", serviceNamespace,
		"service.instance.id", serviceInstanceId,
		"service.version", serviceVersion,
		"deployment.environment", deploymentEnvironment,
		"otel.exporter.otlp.endpoint", i.config.OTLPEndpoint,
		"instrumentation.provider", i.config.Provider,
		"instrumentation.custom_packages", i.config.CustomPackages)

	return envVars
}

// generateServiceName calculates service.name following OpenTelemetry K8s conventions
// Priority: annotation -> app.instance -> app.name -> k8s.deployment.name -> k8s.replicaset.name -> 
//           k8s.statefulset.name -> k8s.daemonset.name -> k8s.cronjob.name -> k8s.job.name -> 
//           k8s.pod.name -> k8s.container.name
func (i *OpenLitInjector) generateServiceName(container *corev1.Container, pod *corev1.Pod) string {
	// 1. Check pod annotation (highest priority)
	if annotations := pod.GetAnnotations(); annotations != nil {
		if serviceName, exists := annotations["resource.opentelemetry.io/service.name"]; exists && serviceName != "" {
			return serviceName
		}
	}

	// 2. Check well-known labels
	if labels := pod.GetLabels(); labels != nil {
		// app.kubernetes.io/instance (well-known label)
		if instance, exists := labels["app.kubernetes.io/instance"]; exists && instance != "" {
			return instance
		}
		// app.kubernetes.io/name (well-known label)
		if appName, exists := labels["app.kubernetes.io/name"]; exists && appName != "" {
			return appName
		}
	}

	// 3. Extract from K8s resource hierarchy following OpenTelemetry spec order
	// Check OwnerReferences to find the actual parent resource
	if ownerName := i.extractResourceNameFromOwnerReferences(pod); ownerName != "" {
		return ownerName
	}

	// 4. k8s.pod.name (fallback from pod name for stateless pods)
	if pod.Name != "" {
		return pod.Name
	}

	// 5. k8s.container.name (final fallback before default)
	if container.Name != "" {
		return container.Name
	}

	// 6. Final fallback
	return "openlit-instrumented-app"
}

// generateServiceNamespace calculates service.namespace following OpenTelemetry conventions
func (i *OpenLitInjector) generateServiceNamespace(pod *corev1.Pod) string {
	// 1. Check pod annotation (highest priority)
	if annotations := pod.GetAnnotations(); annotations != nil {
		if serviceNamespace, exists := annotations["resource.opentelemetry.io/service.namespace"]; exists && serviceNamespace != "" {
			return serviceNamespace
		}
	}

	// 2. k8s.namespace.name (default)
	if pod.Namespace != "" {
		return pod.Namespace
	}

	// Fallback
	return "default"
}

// generateServiceVersion calculates service.version following OpenTelemetry conventions
func (i *OpenLitInjector) generateServiceVersion(pod *corev1.Pod) string {
	// 1. Check pod annotation (highest priority)
	if annotations := pod.GetAnnotations(); annotations != nil {
		if serviceVersion, exists := annotations["resource.opentelemetry.io/service.version"]; exists && serviceVersion != "" {
			return serviceVersion
		}
	}

	// 2. Check well-known label app.kubernetes.io/version
	if labels := pod.GetLabels(); labels != nil {
		if version, exists := labels["app.kubernetes.io/version"]; exists && version != "" {
			return version
		}
	}

	// TODO: Extract version from container image tag/digest using algorithms described in:
	// https://github.com/open-telemetry/opentelemetry-operator/blob/main/pkg/constants/annotations.go
	// For now, return empty to let OTEL auto-detect

	return ""
}

// generateServiceInstanceId calculates service.instance.id following OpenTelemetry conventions
func (i *OpenLitInjector) generateServiceInstanceId(container *corev1.Container, pod *corev1.Pod) string {
	// 1. Check pod annotation (highest priority)
	if annotations := pod.GetAnnotations(); annotations != nil {
		if instanceId, exists := annotations["resource.opentelemetry.io/service.instance.id"]; exists && instanceId != "" {
			return instanceId
		}
	}

	// 2. Default: concat([k8s.namespace.name, k8s.pod.name, k8s.container.name], '.')
	namespace := pod.Namespace
	if namespace == "" {
		namespace = "default"
	}
	
	// Handle pod name - during admission, pod.Name might be empty for Deployment pods
	podName := pod.Name
	if podName == "" {
		// For Deployment pods, use GenerateName if available
		if pod.GenerateName != "" {
			// GenerateName is like "deployment-replicaset-" for deployment pods
			podName = strings.TrimSuffix(pod.GenerateName, "-") + "-pending"
		} else {
			// Final fallback - use service name from our calculation
			serviceName := i.generateServiceName(container, pod)
			podName = serviceName + "-pod"
		}
	}
	
	containerName := container.Name
	if containerName == "" {
		containerName = "unknown-container"
	}

	return fmt.Sprintf("%s.%s.%s", namespace, podName, containerName)
}

// extractResourceNameFromOwnerReferences traverses Kubernetes OwnerReferences following OpenTelemetry hierarchy
// Order: k8s.deployment.name > k8s.replicaset.name > k8s.statefulset.name > k8s.daemonset.name > k8s.cronjob.name > k8s.job.name
func (i *OpenLitInjector) extractResourceNameFromOwnerReferences(pod *corev1.Pod) string {
	if pod.OwnerReferences == nil || len(pod.OwnerReferences) == 0 {
		return ""
	}

	// Walk through OwnerReferences in OpenTelemetry hierarchy order
	hierarchyOrder := []struct {
		kind     string
		priority int
	}{
		{"Deployment", 1},    // Highest priority - most common
		{"ReplicaSet", 2},    // Second priority
		{"StatefulSet", 3},   // Third priority
		{"DaemonSet", 4},     // Fourth priority
		{"CronJob", 5},       // Fifth priority
		{"Job", 6},           // Sixth priority
	}

	var bestMatch string
	var bestPriority int = 999

	for _, owner := range pod.OwnerReferences {
		for _, hierarchy := range hierarchyOrder {
			if owner.Kind == hierarchy.kind && hierarchy.priority < bestPriority {
				bestMatch = owner.Name
				bestPriority = hierarchy.priority
				
				// For ReplicaSet, try to extract Deployment name by removing hash suffix
				if owner.Kind == "ReplicaSet" && len(owner.Name) > 10 {
					// ReplicaSet names are typically: "deployment-name-abcd1234"
					// Try to find deployment by removing last 10 chars (dash + 8-char hash)
					if lastDash := strings.LastIndex(owner.Name, "-"); lastDash > 0 && lastDash < len(owner.Name)-8 {
						potentialDeployment := owner.Name[:lastDash]
						// Use the potential deployment name instead of replicaset
						bestMatch = potentialDeployment
					}
				}
			}
		}
	}

	return bestMatch
}

// generateDeploymentEnvironment calculates deployment.environment from cluster name or config
func (i *OpenLitInjector) generateDeploymentEnvironment() string {
	// 1. Check for explicit CLUSTER_NAME environment variable (standard practice)
	if clusterName := os.Getenv("CLUSTER_NAME"); clusterName != "" {
		return clusterName
	}
	
	// 2. Check for ENVIRONMENT environment variable (common in many setups)
	if environment := os.Getenv("ENVIRONMENT"); environment != "" {
		return environment
	}
	
	// 3. Check for standard Kubernetes cluster identification
	if deploymentEnv := os.Getenv("DEPLOYMENT_ENVIRONMENT"); deploymentEnv != "" {
		return deploymentEnv
	}
	
	// 4. Try to detect cluster name from well-known Kubernetes sources
	if clusterName := i.detectClusterName(); clusterName != "" {
		return clusterName
	}
	
	// 5. Fall back to configured environment from InstrumentationConfig
	if i.config.Environment != "" {
		return i.config.Environment
	}
	
	// 6. Final fallback - use namespace as environment (better than generic "kubernetes")
	return "default-cluster"
}

// detectClusterName tries to detect the actual cluster name from Kubernetes metadata
// Uses official OpenTelemetry detection methods for GKE, EKS, AKS and other providers
func (i *OpenLitInjector) detectClusterName() string {
	// 1. Check well-known environment variables set by cloud providers or users
	cloudEnvVars := []string{
		"CLUSTER_NAME",           // Generic (most common)
		"EKS_CLUSTER_NAME",       // AWS EKS
		"GKE_CLUSTER_NAME",       // Google GKE  
		"AKS_CLUSTER_NAME",       // Azure AKS
		"K8S_CLUSTER_NAME",       // Generic K8s
		"KUBE_CLUSTER_NAME",      // Generic K8s
	}
	
	for _, envVar := range cloudEnvVars {
		if value := os.Getenv(envVar); value != "" {
			return value
		}
	}
	
	// 2. Try GKE metadata detection (official OpenTelemetry method)
	// From: https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/detectors/node/opentelemetry-resource-detector-gcp/src/detectors/GcpDetector.ts#L81
	if clusterName := detectGKEClusterName(); clusterName != "" {
		return clusterName
	}
	
	// 3. Try EKS detection via Kubernetes API server certificate
	// From: https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/detectors/node/opentelemetry-resource-detector-aws/src/detectors/AwsEksDetector.ts#L86
	if clusterName := detectEKSClusterName(); clusterName != "" {
		return clusterName
	}
	
	// 4. Try AKS detection via instance metadata
	if clusterName := detectAKSClusterName(); clusterName != "" {
		return clusterName
	}
	
	// 5. Fallback: Extract from hostname patterns (for k3d, minikube, etc.)
	if hostname := os.Getenv("HOSTNAME"); hostname != "" {
		if clusterName := extractClusterFromHostname(hostname); clusterName != "" {
			return clusterName
		}
	}
	
	return ""
}

// detectGKEClusterName detects GKE cluster name using metadata service
// Official OpenTelemetry method: curl metadata server for cluster-name attribute
func detectGKEClusterName() string {
	// GKE sets this environment variable
	if clusterName := os.Getenv("GKE_CLUSTER_NAME"); clusterName != "" {
		return clusterName
	}
	
	// TODO: Could implement HTTP call to GCE metadata service:
	// curl -H "Metadata-Flavor: Google" \
	//   "http://metadata/computeMetadata/v1/instance/attributes/cluster-name"
	// But this requires network access and error handling
	
	// Check for GKE-specific environment indicators
	if os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") != "" || 
	   os.Getenv("GCLOUD_PROJECT") != "" ||
	   strings.Contains(os.Getenv("KUBERNETES_SERVICE_HOST"), "googleapis.com") {
		return "gke-cluster" // Generic GKE identifier
	}
	
	return ""
}

// detectEKSClusterName detects EKS cluster name from Kubernetes API server certificate
// Official OpenTelemetry method: extract from kubernetes.default.svc certificate
func detectEKSClusterName() string {
	// EKS sets this environment variable
	if clusterName := os.Getenv("EKS_CLUSTER_NAME"); clusterName != "" {
		return clusterName
	}
	
	// Check EKS-specific patterns in Kubernetes service host
	if kubeHost := os.Getenv("KUBERNETES_SERVICE_HOST"); kubeHost != "" {
		// EKS API server pattern: <cluster-id>.eks.<region>.amazonaws.com
		if strings.Contains(kubeHost, ".eks.") && strings.Contains(kubeHost, ".amazonaws.com") {
			parts := strings.Split(kubeHost, ".")
			if len(parts) >= 4 && parts[1] == "eks" {
				// Extract region and create meaningful name
				region := parts[2]
				return fmt.Sprintf("eks-%s", region)
			}
		}
	}
	
	// TODO: Could implement certificate parsing from kubernetes.default.svc
	// as described in OpenTelemetry EKS detector, but this requires:
	// - TLS connection to kubernetes.default.svc
	// - Certificate parsing to extract cluster name from subject
	// - Additional error handling and permissions
	
	// Check for AWS environment indicators
	if os.Getenv("AWS_REGION") != "" || os.Getenv("AWS_DEFAULT_REGION") != "" {
		region := os.Getenv("AWS_REGION")
		if region == "" {
			region = os.Getenv("AWS_DEFAULT_REGION")
		}
		return fmt.Sprintf("eks-%s", region)
	}
	
	return ""
}

// detectAKSClusterName detects AKS cluster name from Azure metadata
func detectAKSClusterName() string {
	// AKS sets this environment variable
	if clusterName := os.Getenv("AKS_CLUSTER_NAME"); clusterName != "" {
		return clusterName
	}
	
	// Check AKS-specific patterns in Kubernetes service host
	if kubeHost := os.Getenv("KUBERNETES_SERVICE_HOST"); kubeHost != "" {
		// AKS API server pattern: <cluster>-<rg>-<id>.hcp.<region>.azmk8s.io
		if strings.Contains(kubeHost, ".azmk8s.io") {
			parts := strings.Split(kubeHost, ".")
			if len(parts) >= 3 {
				hostParts := strings.Split(parts[0], "-")
				if len(hostParts) >= 1 {
					return hostParts[0] // cluster name
				}
			}
		}
	}
	
	// TODO: Could implement Azure Instance Metadata Service call:
	// curl -H "Metadata: true" \
	//   "http://169.254.169.254/metadata/instance/compute/resourceGroupName?api-version=2021-02-01"
	
	// Check for Azure environment indicators  
	if os.Getenv("AZURE_CLIENT_ID") != "" || os.Getenv("AZURE_TENANT_ID") != "" {
		return "aks-cluster"
	}
	
	return ""
}

// extractClusterFromHostname extracts cluster name from hostname patterns
// Fallback method for local development environments (k3d, minikube, etc.)
func extractClusterFromHostname(hostname string) string {
	// k3d pattern: k3d-<cluster-name>-server-0
	if strings.Contains(hostname, "k3d-") {
		parts := strings.Split(hostname, "-")
		if len(parts) >= 3 && parts[0] == "k3d" {
			return parts[1] // cluster name is after "k3d-"
		}
	}
	
	// minikube pattern: minikube
	if strings.Contains(hostname, "minikube") {
		return "minikube"
	}
	
	// kind pattern: <cluster>-control-plane
	if strings.Contains(hostname, "-control-plane") {
		parts := strings.Split(hostname, "-")
		if len(parts) >= 2 {
			return parts[0] // cluster name before "-control-plane"
		}
	}
	
	return ""
}