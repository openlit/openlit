/*
OpenLIT Admission Webhook Handler

This is the core admission webhook that implements zero-code instrumentation
by intercepting pod creation requests and automatically injecting OpenTelemetry
instrumentation into matching pods based on AutoInstrumentation Custom Resources.

Key responsibilities:
- Intercepts pod creation through Kubernetes admission controller
- Matches pods against AutoInstrumentation selector criteria
- Injects init containers with instrumentation packages
- Configures environment variables for OpenTelemetry
- Handles multiple instrumentation providers (OpenLIT, OpenInference, OpenLLMetry)
- Provides comprehensive error handling and observability

The webhook works by:
1. Receiving admission review requests for pod creation
2. Finding matching AutoInstrumentation CRs for the pod's namespace and labels
3. Creating injector configuration from the CR settings
4. Modifying the pod spec to include instrumentation init containers
5. Returning the modified pod specification to Kubernetes

Supports advanced features:
- Custom package installation
- Provider-specific configurations
- Environment variable injection from secrets/configmaps
- Namespace-scoped and cluster-wide instrumentation
- Skip/ignore patterns for fine-grained control

This is where the "magic" of zero-code instrumentation happens!
*/
package webhook

import (
	"context"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"sigs.k8s.io/controller-runtime/pkg/webhook/admission"

	"github.com/openlit/openlit/operator/api/v1alpha1"
	"github.com/openlit/openlit/operator/internal/config"
	"github.com/openlit/openlit/operator/internal/injector"
	"github.com/openlit/openlit/operator/internal/observability"
)

var log = observability.NewLogger("webhook")

// Use central schema - no local type aliases needed

// Functions removed - using central v1alpha1.AutoInstrumentation type with generated methods

// All type definitions removed - using central v1alpha1 package types

// Handler implements the admission.Handler interface
type Handler struct {
	decoder       admission.Decoder
	dynamicClient dynamic.Interface
	config        *config.OperatorConfig
}

// NewHandler creates a new webhook handler
func NewHandler(cfg *config.OperatorConfig, scheme *runtime.Scheme, dynamicClient dynamic.Interface) *Handler {
	decoder := admission.NewDecoder(scheme)
	return &Handler{
		config:        cfg,
		dynamicClient: dynamicClient,
		decoder:       decoder,
	}
}

// Handle handles the admission requests for pod injection
func (h *Handler) Handle(ctx context.Context, req admission.Request) admission.Response {
	log.Info("🔍 Webhook received admission request",
		"component", "webhook-handler",
		"k8s.admission.request.kind", req.Kind.Kind,
		"k8s.admission.request.name", req.Name,
		"k8s.admission.request.namespace", req.Namespace,
		"k8s.admission.request.uid", string(req.UID),
		"k8s.admission.request.operation", string(req.Operation))

	pod := &corev1.Pod{}

	err := h.decoder.Decode(req, pod)
	if err != nil {
		log.Error("Failed to decode admission request", err,
			"component", "webhook-handler",
			"k8s.admission.request.uid", string(req.UID))
		return admission.Errored(http.StatusBadRequest, err)
	}

	log.Info("📋 Checking pod for instrumentation",
		"component", "webhook-handler",
		"k8s.pod.name", pod.Name,
		"k8s.namespace.name", pod.Namespace,
		"k8s.pod.labels", fmt.Sprintf("%v", pod.Labels))

	// Find matching AutoInstrumentation CRs
	instrConfig, err := h.findMatchingAutoInstrumentation(ctx, pod)
	if err != nil {
		log.Error("Failed to find matching AutoInstrumentation", err,
			"component", "webhook-handler",
			"k8s.pod.name", pod.Name,
			"k8s.namespace.name", pod.Namespace)
		return admission.Errored(http.StatusInternalServerError, err)
	}

	if instrConfig == nil {
		log.Info("⏭️ No matching AutoInstrumentation found",
			"component", "webhook-handler",
			"k8s.pod.name", pod.Name,
			"k8s.namespace.name", pod.Namespace,
			"k8s.pod.labels", fmt.Sprintf("%v", pod.Labels))
		return admission.Allowed("no matching instrumentation config")
	}

	log.Info("🚀 Found matching AutoInstrumentation, injecting instrumentation",
		"component", "webhook-handler",
		"k8s.pod.name", pod.Name,
		"k8s.namespace.name", pod.Namespace,
		"instrumentation.config.name", instrConfig.Name,
		"instrumentation.config.namespace", instrConfig.Namespace,
					"instrumentation.provider", instrConfig.Spec.Python.Instrumentation.Provider)

	// Create injector with the CR configuration
	injectorConfig := h.createInjectorConfig(instrConfig)
	injector := injector.New(injectorConfig)
	
	// Inject instrumentation
	injector.InjectOpenLIT(pod)

	// Create JSON patch from the differences
	podBytes, err := json.Marshal(pod)
	if err != nil {
		return admission.Errored(http.StatusInternalServerError, err)
	}

	log.Info("✅ Instrumentation injected successfully",
		"component", "webhook-handler",
		"k8s.pod.name", pod.Name,
		"k8s.namespace.name", pod.Namespace,
		"instrumentation.provider", instrConfig.Spec.Python.Instrumentation.Provider,
		"instrumentation.config.name", instrConfig.Name)
	return admission.PatchResponseFromRaw(req.Object.Raw, podBytes)
}

// findMatchingAutoInstrumentation finds the best matching AutoInstrumentation with conflict detection
func (h *Handler) findMatchingAutoInstrumentation(ctx context.Context, pod *corev1.Pod) (*v1alpha1.AutoInstrumentation, error) {
	// Define the AutoInstrumentation GVR
	gvr := schema.GroupVersionResource{
		Group:    "openlit.io",
		Version:  "v1alpha1",
		Resource: "autoinstrumentations",
	}
	
	// Search order: App-specific (same namespace) → Global (openlit)
	namespaces := []string{pod.Namespace, "openlit"}
	
	for _, namespace := range namespaces {
		log.Info("🔍 Searching for AutoInstrumentations",
			"component", "webhook-handler",
			"k8s.namespace.name", namespace)
		
		// List AutoInstrumentations in this namespace
		result, err := h.dynamicClient.Resource(gvr).Namespace(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			log.Error("Failed to list AutoInstrumentations", err,
				"component", "webhook-handler",
				"k8s.namespace.name", namespace)
			continue
		}

		log.Info("📋 Found AutoInstrumentations",
			"component", "webhook-handler",
			"k8s.namespace.name", namespace,
			"instrumentation.config.count", len(result.Items))

		// Collect all matching configs in this namespace
		var matchingConfigs []*v1alpha1.AutoInstrumentation
		
		for _, item := range result.Items {
			cfg, err := h.parseAutoInstrumentation(item.Object)
			if err != nil {
				log.Error("Failed to parse AutoInstrumentation", err,
					"component", "webhook-handler",
					"instrumentation.config.name", item.GetName(),
					"k8s.namespace.name", namespace)
				continue
			}

			if cfg.Spec.Selector.MatchLabels != nil {
				log.Info("🎯 Checking selector",
					"component", "webhook-handler",
					"instrumentation.config.name", cfg.Name,
					"instrumentation.config.namespace", cfg.Namespace,
					"instrumentation.config.selector", fmt.Sprintf("%v", cfg.Spec.Selector.MatchLabels),
					"k8s.pod.labels", fmt.Sprintf("%v", pod.Labels))
					
				if h.podMatchesSelector(pod, cfg.Spec.Selector.MatchLabels) {
					log.Info("✅ Found matching config",
						"component", "webhook-handler",
						"instrumentation.config.name", cfg.Name,
						"instrumentation.config.namespace", cfg.Namespace,
						"instrumentation.provider", cfg.Spec.Python.Instrumentation.Provider)
					
					// Note: Management labels are handled proactively by the AutoInstrumentation controller
					
					matchingConfigs = append(matchingConfigs, cfg)
				}
			}
		}
		
		// Handle conflicts and select the oldest match (first created)
		if len(matchingConfigs) > 1 {
			// Sort by creation timestamp for deterministic first-created-wins behavior
			sort.Slice(matchingConfigs, func(i, j int) bool {
				return matchingConfigs[i].CreationTimestamp.Before(&matchingConfigs[j].CreationTimestamp)
			})
			
			// Log warning about conflicts
			var conflictNames []string
			for _, cfg := range matchingConfigs {
				conflictNames = append(conflictNames, fmt.Sprintf("%s/%s(%s,created:%s)", 
					cfg.Namespace, cfg.Name, cfg.Spec.Python.Instrumentation.Provider, 
					cfg.CreationTimestamp.Format("15:04:05")))
			}
			
			log.Info("⚠️ Multiple AutoInstrumentations match this pod - using oldest one (first created)",
				"component", "webhook-handler",
				"k8s.pod.name", pod.Name,
				"k8s.pod.namespace", pod.Namespace,
				"instrumentation.config.selected", fmt.Sprintf("%s/%s(%s,created:%s)",
					matchingConfigs[0].Namespace, matchingConfigs[0].Name,
					matchingConfigs[0].Spec.Python.Instrumentation.Provider,
					matchingConfigs[0].CreationTimestamp.Format("15:04:05")),
				"instrumentation.config.conflicts", conflictNames)
		}
		
		// Return the first matching config if any found
		if len(matchingConfigs) > 0 {
			return matchingConfigs[0], nil
		}
	}

	return nil, nil
}

// parseAutoInstrumentation converts unstructured data to AutoInstrumentation
func (h *Handler) parseAutoInstrumentation(obj map[string]interface{}) (*v1alpha1.AutoInstrumentation, error) {
	// Extract metadata
	metadata := obj["metadata"].(map[string]interface{})
	name := metadata["name"].(string)
	namespace := metadata["namespace"].(string)
	
	// Parse creation timestamp
	var creationTimestamp metav1.Time
	if creationTimeStr, ok := metadata["creationTimestamp"].(string); ok {
		if parsedTime, err := time.Parse(time.RFC3339, creationTimeStr); err == nil {
			creationTimestamp = metav1.NewTime(parsedTime)
		}
	}
	
	// Extract spec
	spec := obj["spec"].(map[string]interface{})
	
	cfg := &v1alpha1.AutoInstrumentation{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			Namespace:         namespace,
			CreationTimestamp: creationTimestamp,
		},
		Spec: v1alpha1.AutoInstrumentationSpec{},
	}
	
	// Parse selector
	if selectorData, ok := spec["selector"].(map[string]interface{}); ok {
		if matchLabels, ok := selectorData["matchLabels"].(map[string]interface{}); ok {
			cfg.Spec.Selector.MatchLabels = make(map[string]string)
			for k, v := range matchLabels {
				cfg.Spec.Selector.MatchLabels[k] = v.(string)
			}
		}
	}
	
	// Parse python config
	if pythonData, ok := spec["python"].(map[string]interface{}); ok {
		cfg.Spec.Python = &v1alpha1.PythonInstrumentation{
			Instrumentation: &v1alpha1.InstrumentationSettings{},
		}
		if instrumentationData, ok := pythonData["instrumentation"].(map[string]interface{}); ok {
			if enabled, ok := instrumentationData["enabled"].(bool); ok {
				cfg.Spec.Python.Instrumentation.Enabled = &enabled
			}
			if provider, ok := instrumentationData["provider"].(string); ok {
				cfg.Spec.Python.Instrumentation.Provider = provider
			}
			if version, ok := instrumentationData["version"].(string); ok {
				cfg.Spec.Python.Instrumentation.Version = version
			}
			if imagePullPolicy, ok := instrumentationData["imagePullPolicy"].(string); ok {
				cfg.Spec.Python.Instrumentation.ImagePullPolicy = imagePullPolicy
			}
			if customPackages, ok := instrumentationData["customPackages"].(string); ok {
				cfg.Spec.Python.Instrumentation.CustomPackages = customPackages
			}
			if customInitImage, ok := instrumentationData["customInitImage"].(string); ok {
				cfg.Spec.Python.Instrumentation.CustomInitImage = customInitImage
			}
		}
	}
	
	// Parse OTLP config
	if otlpData, ok := spec["otlp"].(map[string]interface{}); ok {
		if endpoint, ok := otlpData["endpoint"].(string); ok {
			cfg.Spec.OTLP.Endpoint = endpoint
		}
		if headers, ok := otlpData["headers"].(string); ok {
			cfg.Spec.OTLP.Headers = headers
		}
		if timeout, ok := otlpData["timeout"].(float64); ok {
			timeoutInt32 := int32(timeout)
			cfg.Spec.OTLP.Timeout = &timeoutInt32
		}
	}
	
	// Parse resource config
	if resourceData, ok := spec["resource"].(map[string]interface{}); ok {
		cfg.Spec.Resource = &v1alpha1.ResourceConfig{}
		if environment, ok := resourceData["environment"].(string); ok {
			cfg.Spec.Resource.Environment = environment
		}
	}
	
	return cfg, nil
}

// podMatchesSelector checks if pod labels match the selector
func (h *Handler) podMatchesSelector(pod *corev1.Pod, selector map[string]string) bool {
	podLabels := pod.GetLabels()
	if podLabels == nil {
		return false
	}

	for key, value := range selector {
		if podLabels[key] != value {
			return false
		}
	}
	return true
}

// createInjectorConfig creates injector config from AutoInstrumentation CR
func (h *Handler) createInjectorConfig(instrConfig *v1alpha1.AutoInstrumentation) *injector.InjectorConfig {
	// Convert ImagePullPolicy string to corev1.PullPolicy
	var pullPolicy corev1.PullPolicy
	switch instrConfig.Spec.Python.Instrumentation.ImagePullPolicy {
	case "Always":
		pullPolicy = corev1.PullAlways
	case "Never":
		pullPolicy = corev1.PullNever
	case "IfNotPresent":
		fallthrough
	default:
		pullPolicy = corev1.PullIfNotPresent
	}
	
	cfg := &injector.InjectorConfig{
		// From AutoInstrumentation CR
		Provider:      instrConfig.Spec.Python.Instrumentation.Provider,
		OTLPEndpoint:  instrConfig.Spec.OTLP.Endpoint,
		OTLPHeaders:   instrConfig.Spec.OTLP.Headers,
		ImagePullPolicy: pullPolicy,
		
		// Resource configuration
		Environment: "",
		ServiceName: "instrumented-app",
		ServiceNamespace: instrConfig.Namespace,
		
		// Instrumentation settings (set defaults)
		CaptureMessageContent: true,
		DetailedTracing:       true,
		
		// Custom packages/image
		CustomPackages: "",
		CustomInitImage: "",
	}
	
	// Set environment from resource config
	if instrConfig.Spec.Resource != nil {
		cfg.Environment = instrConfig.Spec.Resource.Environment
	}
	
	// Set custom packages and image if specified
	if instrConfig.Spec.Python != nil && instrConfig.Spec.Python.Instrumentation != nil {
		if instrConfig.Spec.Python.Instrumentation.CustomPackages != "" {
			cfg.CustomPackages = instrConfig.Spec.Python.Instrumentation.CustomPackages
		}
		
		// Set custom init image if specified
		if instrConfig.Spec.Python.Instrumentation.CustomInitImage != "" {
			cfg.CustomInitImage = instrConfig.Spec.Python.Instrumentation.CustomInitImage
		} else {
			// Use provider-specific image
			cfg.InitContainerImage = h.getProviderImage(instrConfig.Spec.Python.Instrumentation.Provider)
		}
	}
	
	// Convert CR env vars to corev1.EnvVar
	if instrConfig.Spec.Python != nil && instrConfig.Spec.Python.Instrumentation != nil {
		cfg.EnvVars = make([]corev1.EnvVar, len(instrConfig.Spec.Python.Instrumentation.Env))
		for i, envVar := range instrConfig.Spec.Python.Instrumentation.Env {
			cfg.EnvVars[i] = corev1.EnvVar{
				Name:  envVar.Name,
				Value: envVar.Value,
			}
			
			// Handle valueFrom if specified
			if envVar.ValueFrom != nil {
				cfg.EnvVars[i].ValueFrom = &corev1.EnvVarSource{}
				
				if envVar.ValueFrom.SecretKeyRef != nil {
					cfg.EnvVars[i].ValueFrom.SecretKeyRef = &corev1.SecretKeySelector{
						LocalObjectReference: corev1.LocalObjectReference{
							Name: envVar.ValueFrom.SecretKeyRef.Name,
						},
						Key:      envVar.ValueFrom.SecretKeyRef.Key,
						Optional: envVar.ValueFrom.SecretKeyRef.Optional,
					}
				}
				
				if envVar.ValueFrom.ConfigMapKeyRef != nil {
					cfg.EnvVars[i].ValueFrom.ConfigMapKeyRef = &corev1.ConfigMapKeySelector{
						LocalObjectReference: corev1.LocalObjectReference{
							Name: envVar.ValueFrom.ConfigMapKeyRef.Name,
						},
						Key:      envVar.ValueFrom.ConfigMapKeyRef.Key,
						Optional: envVar.ValueFrom.ConfigMapKeyRef.Optional,
					}
				}
				
				if envVar.ValueFrom.FieldRef != nil {
					cfg.EnvVars[i].ValueFrom.FieldRef = &corev1.ObjectFieldSelector{
						APIVersion: envVar.ValueFrom.FieldRef.APIVersion,
						FieldPath:  envVar.ValueFrom.FieldRef.FieldPath,
					}
				}
			}
		}
	}
	
	return cfg
}

// getProviderImage returns the appropriate image for the provider
func (h *Handler) getProviderImage(provider string) string {
	switch provider {
	case "openlit":
		return "openlit-instrumentation:latest"
	case "openinference":
		return "openinference-instrumentation:latest"
	case "openllmetry":
		return "openlit/openllmetry-instrumentation:latest"
	case "custom", "base":
		return "openlit/base-instrumentation:latest"
	default:
		return "openlit-instrumentation:latest"
	}
}

// addManagementLabel adds a management label to the AutoInstrumentation CR to indicate
// it is being managed/used by this OpenLIT operator instance
func (h *Handler) addManagementLabel(ctx context.Context, cfg *v1alpha1.AutoInstrumentation, namespace string, gvr schema.GroupVersionResource) error {
	// Check if the label already exists
	if cfg.Labels != nil {
		if _, exists := cfg.Labels["openlit.io/managed-by"]; exists {
			// Label already exists, no need to update
			return nil
		}
	}
	
	// Get the operator instance details for the label value
	operatorNamespace := h.config.Namespace
	if operatorNamespace == "" {
		// Try to get from service account, fallback to schema default
		operatorNamespace = getNamespaceFromServiceAccount()
	}
	// Try to get actual pod name from hostname, fallback to static name
	operatorName := getOperatorPodName()
	
	// Create the management label value
	managementLabel := fmt.Sprintf("%s.%s", operatorName, operatorNamespace)
	
	log.Info("🏷️ Adding management label to AutoInstrumentation",
		"component", "webhook-handler",
		"instrumentation.config.name", cfg.Name,
		"instrumentation.config.namespace", cfg.Namespace,
		"management.label", managementLabel)
	
	// Prepare the patch to add the label
	patch := map[string]interface{}{
		"metadata": map[string]interface{}{
			"labels": map[string]interface{}{
				"openlit.io/managed-by": managementLabel,
				"openlit.io/instrumented-by": "openlit-operator",
			},
		},
	}
	
	// Convert patch to JSON
	patchBytes, err := json.Marshal(patch)
	if err != nil {
		return fmt.Errorf("failed to marshal patch: %w", err)
	}
	
	// Apply the patch
	_, err = h.dynamicClient.Resource(gvr).Namespace(cfg.Namespace).Patch(
		ctx,
		cfg.Name,
		types.MergePatchType,
		patchBytes,
		metav1.PatchOptions{},
	)
	if err != nil {
		return fmt.Errorf("failed to patch AutoInstrumentation with management labels: %w", err)
	}
	
	log.Info("✅ Successfully added management labels to AutoInstrumentation",
		"component", "webhook-handler",
		"instrumentation.config.name", cfg.Name,
		"instrumentation.config.namespace", cfg.Namespace,
		"openlit.io/managed-by", managementLabel,
		"openlit.io/instrumented-by", "openlit-operator")
	
	return nil
}

// InjectDecoder injects the decoder
func (h *Handler) InjectDecoder(d admission.Decoder) error {
	h.decoder = d
	return nil
}

// getOperatorPodName gets the actual pod name from hostname or falls back to static name
func getOperatorPodName() string {
	// Try to get actual pod name from hostname (Kubernetes sets this to pod name)
	if hostname, err := os.Hostname(); err == nil && hostname != "" {
		return hostname
	}
	// Fallback to operator name
	return "openlit-operator"
}

// getNamespaceFromServiceAccount gets the current namespace from the service account token
func getNamespaceFromServiceAccount() string {
	// Read namespace from service account token (standard Kubernetes mount)
	if data, err := ioutil.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace"); err == nil {
		namespace := strings.TrimSpace(string(data))
		if namespace != "" {
			return namespace
		}
	}
	// Fallback to default
	return "openlit"
}