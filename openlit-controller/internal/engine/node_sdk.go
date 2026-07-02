package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
	"go.uber.org/zap"
)

const (
	nodeSDKRuntime             = "nodejs"
	nodeSystemdSDKStateDir     = "/var/lib/openlit/nodejs-sdk"
	nodeBareProcessSDKStateDir = "/var/lib/openlit/nodejs-sdk"
	nodeOpenLITRegisterModule  = "openlit/register"
	nodeOTelAutoRegisterModule = "@opentelemetry/auto-instrumentations-node/register"
	nodeOTelSDKModule          = "@opentelemetry/sdk-node"
)

var controllerManagedNodeDisabledInstrumentors = []string{
	"openai",
	"anthropic",
	"cohere",
	"groq",
	"ai21",
	"gradient",
	"mistral",
	"google-ai",
	"vertexai",
	"together",
	"ollama",
	"bedrock",
	"azure-ai-inference",
	"huggingface",
	"replicate",
	"elevenlabs",
	"transformers",
	"http",
	"undici",
}

func (e *Engine) EnableNodeJSSDK(serviceID string, payload openlit.SDKActionPayload) error {
	payload = e.normalizeSDKPayload(payload, nodeSDKRuntime)
	if !isValidSDKVersion(payload.SDKVersion) {
		return fmt.Errorf("invalid sdk_version %q: must match a safe npm package version (letters, digits, . _ + -)", payload.SDKVersion)
	}

	svc, err := e.serviceSnapshot(serviceID)
	if err != nil {
		return err
	}
	if !isNodeRuntime(svc.LanguageRuntime) {
		e.setAgentObservabilityState(
			serviceID,
			"unsupported",
			"none",
			"",
			"Controller-managed JavaScript/TypeScript SDK injection is only available for Node.js services",
		)
		return fmt.Errorf("service %q is not a Node.js runtime", svc.ServiceName)
	}
	if svc.AgentObservabilityStatus == "enabled" && svc.AgentObservabilitySource == "existing_openlit" {
		e.setAgentObservabilityState(
			serviceID,
			"enabled",
			"existing_openlit",
			"",
			"Existing OpenLIT instrumentation is not controller-managed and will not be removed automatically",
		)
		return fmt.Errorf("service %q uses existing OpenLIT instrumentation that is not controller-managed", svc.ServiceName)
	}

	sdkVersionLabel := payload.SDKVersion
	if sdkVersionLabel == "" {
		sdkVersionLabel = "latest"
	}

	switch e.deployMode {
	case config.DeployKubernetes:
		if err := e.enableNodeJSSDKKubernetes(svc, payload); err != nil {
			return err
		}
		e.setDesiredAgentObservabilityState(serviceID, "enabled", "controller_managed", "", "Controller-managed JavaScript/TypeScript SDK rollout configured for Kubernetes workload")
	case config.DeployDocker:
		if err := e.enableNodeJSSDKDocker(svc, payload); err != nil {
			return err
		}
		e.setDesiredAgentObservabilityState(serviceID, "enabled", "controller_managed", "", "Controller-managed JavaScript/TypeScript SDK rollout configured for Docker container")
	default:
		isContainerized := svc.ResourceAttributes["openlit.is_containerized"] == "true"
		containerID := svc.ResourceAttributes["container.id"]
		if isContainerized && containerID != "" {
			if e.container != nil && e.container.dockerClient != nil && e.container.dockerClient.canManage() {
				if err := e.enableNodeJSSDKDocker(svc, payload); err != nil {
					return err
				}
				e.setDesiredAgentObservabilityState(serviceID, "enabled", "controller_managed", "", "Controller-managed JavaScript/TypeScript SDK rollout configured for Docker container (detected from Linux host)")
				e.setSDKVersionAttr(serviceID, sdkVersionLabel)
				return nil
			}
			e.setDesiredAgentObservabilityState(
				serviceID,
				"unsupported",
				"none",
				"",
				"This process runs inside a container but the Docker socket is not available. Mount /var/run/docker.sock or use Docker-mode controller for Agent Observability.",
			)
			return fmt.Errorf("containerized process detected but Docker socket not available for Agent O11y")
		}
		if svc.ResourceAttributes["systemd.unit"] != "" {
			if err := e.enableNodeJSSDKLinux(svc, payload); err != nil {
				return err
			}
			e.setDesiredAgentObservabilityState(serviceID, "enabled", "controller_managed", "", "Controller-managed JavaScript/TypeScript SDK rollout configured for systemd service")
		} else if err := e.enableNodeJSSDKBareProcess(svc, payload); err != nil {
			return err
		}
	}
	e.setSDKVersionAttr(serviceID, sdkVersionLabel)
	return nil
}

func (e *Engine) DisableNodeJSSDK(serviceID string, _ openlit.SDKActionPayload) error {
	svc, err := e.serviceSnapshot(serviceID)
	if err != nil {
		return err
	}
	if !isNodeRuntime(svc.LanguageRuntime) {
		e.setAgentObservabilityState(
			serviceID,
			"unsupported",
			"none",
			"",
			"Controller-managed JavaScript/TypeScript SDK injection is only available for Node.js services",
		)
		return fmt.Errorf("service %q is not a Node.js runtime", svc.ServiceName)
	}

	switch e.deployMode {
	case config.DeployKubernetes:
		if err := e.disableNodeJSSDKKubernetes(svc); err != nil {
			return err
		}
		e.setDesiredAgentObservabilityState(serviceID, "disabled", "none", "", "Controller-managed JavaScript/TypeScript SDK removed from Kubernetes workload")
	case config.DeployDocker:
		if err := e.disableNodeJSSDKDocker(svc); err != nil {
			return err
		}
		e.setDesiredAgentObservabilityState(serviceID, "disabled", "none", "", "Controller-managed JavaScript/TypeScript SDK removed from Docker container")
	default:
		isContainerized := svc.ResourceAttributes["openlit.is_containerized"] == "true"
		containerID := svc.ResourceAttributes["container.id"]
		if isContainerized && containerID != "" {
			if e.container != nil && e.container.dockerClient != nil && e.container.dockerClient.canManage() {
				if err := e.disableNodeJSSDKDocker(svc); err != nil {
					return err
				}
				e.setDesiredAgentObservabilityState(serviceID, "disabled", "none", "", "Controller-managed JavaScript/TypeScript SDK removed from Docker container (detected from Linux host)")
				return nil
			}
			return fmt.Errorf("containerized process detected but Docker socket not available to disable Agent O11y")
		}
		if svc.ResourceAttributes["systemd.unit"] != "" {
			if err := e.disableNodeJSSDKLinux(svc); err != nil {
				return err
			}
			e.setDesiredAgentObservabilityState(serviceID, "disabled", "none", "", "Controller-managed JavaScript/TypeScript SDK removed from systemd service")
		} else if err := e.disableNodeJSSDKBareProcess(svc); err != nil {
			return err
		}
	}
	return nil
}

func (e *Engine) enableNodeJSSDKKubernetes(svc *openlit.ServiceState, payload openlit.SDKActionPayload) error {
	if e.container == nil || e.container.k8sClient == nil {
		return fmt.Errorf("kubernetes client unavailable for JavaScript/TypeScript SDK injection")
	}
	namespace := svc.ResourceAttributes["k8s.namespace.name"]
	workloadKind := svc.ResourceAttributes["k8s.workload.kind"]
	workloadName := svc.DeploymentName
	containerName := svc.ResourceAttributes["container.name"]
	if workloadKind == "" || workloadKind == "Pod" {
		return e.enableNodeJSSDKNakedPod(svc, payload)
	}
	if namespace == "" || workloadName == "" {
		return fmt.Errorf("missing Kubernetes workload metadata for %s", svc.ServiceName)
	}
	workload, err := e.container.k8sClient.getWorkload(namespace, workloadKind, workloadName)
	if err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to fetch workload %s/%s: %v", workloadKind, workloadName, err))
		return err
	}
	container, err := findTargetContainer(workload, containerName)
	if err != nil {
		return err
	}
	preflight := evaluateNodeJSSDKPreflight(extractContainerEnv(container), flattenContainerCommand(container), payload.DuplicatePolicy)
	if err := e.applySDKPreflightResult(svc.ID, preflight); err != nil {
		return err
	}
	if preflight.Decision == pythonSDKDecisionAdopt {
		return nil
	}
	patch, err := buildNodeJSSDKWorkloadPatch(workload, containerName, svc, payload, true)
	if err != nil {
		return err
	}
	if err := e.container.k8sClient.patchWorkload(namespace, workloadKind, workloadName, patch); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to patch workload %s/%s: %v", workloadKind, workloadName, err))
		return err
	}
	e.setAgentObservabilityState(svc.ID, "enabled", "controller_managed", "", fmt.Sprintf("OpenLIT SDK injected via %s/%s patch (workload %s)", workloadKind, workloadName, svc.WorkloadKey))
	return nil
}

func (e *Engine) disableNodeJSSDKKubernetes(svc *openlit.ServiceState) error {
	if e.container == nil || e.container.k8sClient == nil {
		return fmt.Errorf("kubernetes client unavailable for JavaScript/TypeScript SDK removal")
	}
	namespace := svc.ResourceAttributes["k8s.namespace.name"]
	workloadKind := svc.ResourceAttributes["k8s.workload.kind"]
	workloadName := svc.DeploymentName
	containerName := svc.ResourceAttributes["container.name"]
	if workloadKind == "" || workloadKind == "Pod" {
		return e.disableNodeJSSDKNakedPod(svc)
	}
	if namespace == "" || workloadName == "" {
		return fmt.Errorf("missing Kubernetes workload metadata for %s", svc.ServiceName)
	}
	workload, err := e.container.k8sClient.getWorkload(namespace, workloadKind, workloadName)
	if err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to fetch workload %s/%s: %v", workloadKind, workloadName, err))
		return err
	}
	patch, err := buildNodeJSSDKWorkloadPatch(workload, containerName, svc, openlit.SDKActionPayload{}, false)
	if err != nil {
		return err
	}
	if err := e.container.k8sClient.patchWorkload(namespace, workloadKind, workloadName, patch); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to patch workload %s/%s: %v", workloadKind, workloadName, err))
		return err
	}
	e.setAgentObservabilityState(svc.ID, "disabled", "none", "", fmt.Sprintf("OpenLIT SDK removed via %s/%s patch (workload %s)", workloadKind, workloadName, svc.WorkloadKey))
	return nil
}

func (e *Engine) enableNodeJSSDKNakedPod(svc *openlit.ServiceState, payload openlit.SDKActionPayload) error {
	namespace := svc.ResourceAttributes["k8s.namespace.name"]
	podName := svc.ResourceAttributes["k8s.pod.name"]
	containerName := svc.ResourceAttributes["container.name"]
	if namespace == "" || podName == "" {
		return fmt.Errorf("missing pod metadata for naked pod %s", svc.ServiceName)
	}
	pod, err := e.container.k8sClient.getPod(namespace, podName)
	if err != nil {
		return fmt.Errorf("fetching naked pod %s/%s: %w", namespace, podName, err)
	}
	spec, _ := pod["spec"].(map[string]any)
	if spec == nil {
		return fmt.Errorf("pod %s/%s has no spec", namespace, podName)
	}
	containers, err := extractContainers(spec["containers"])
	if err != nil {
		return err
	}
	targetIndex, err := selectContainerIndex(containers, containerName)
	if err != nil {
		return err
	}
	preflight := evaluateNodeJSSDKPreflight(extractContainerEnv(containers[targetIndex]), flattenContainerCommand(containers[targetIndex]), payload.DuplicatePolicy)
	if err := e.applySDKPreflightResult(svc.ID, preflight); err != nil {
		return err
	}
	if preflight.Decision == pythonSDKDecisionAdopt {
		return nil
	}
	appImage := resolveContainerImage(containers, containerName)
	if appImage == "" {
		return fmt.Errorf("cannot resolve image for naked pod container %q", containerName)
	}
	if err := applyNodeJSSDKContainerSettings(containers[targetIndex], svc, payload); err != nil {
		return err
	}
	initContainer := map[string]any{
		"name":    openlitInstrumentationInitName,
		"image":   appImage,
		"command": []any{"sh", "-c", buildNPMInstallShellCmd(openlitInstrumentationMountPath, payload.SDKVersion)},
		"volumeMounts": []any{map[string]any{
			"name":      openlitInstrumentationVolume,
			"mountPath": openlitInstrumentationMountPath,
		}},
	}
	if policy := resolveContainerImagePullPolicy(containers, containerName); policy != "" {
		initContainer["imagePullPolicy"] = policy
	}
	spec["initContainers"] = objectSliceToAny(upsertNamedObject(extractObjectSlice(spec["initContainers"]), openlitInstrumentationInitName, initContainer))
	spec["volumes"] = objectSliceToAny(upsertNamedObject(extractObjectSlice(spec["volumes"]), openlitInstrumentationVolume, map[string]any{
		"name":     openlitInstrumentationVolume,
		"emptyDir": map[string]any{},
	}))
	spec["containers"] = objectSliceToAny(containers)

	metadata, _ := pod["metadata"].(map[string]any)
	annotations := copyStringMap(metadata["annotations"])
	setManagedSDKAnnotations(annotations, svc, payload, nodeSDKRuntime)
	stripPodRuntimeFields(pod)
	if metaMap, ok := pod["metadata"].(map[string]any); ok {
		metaMap["annotations"] = stringMapToAny(annotations)
	}
	originalPodJSON, marshalErr := json.Marshal(pod)
	if marshalErr != nil {
		return fmt.Errorf("marshaling naked pod %s/%s before SDK injection: %w", namespace, podName, marshalErr)
	}
	e.logger.Info("recreating naked pod for Node.js SDK injection; original spec captured for rollback", zap.String("namespace", namespace), zap.String("pod", podName), zap.ByteString("original_spec", originalPodJSON))
	if err := e.container.k8sClient.deletePod(namespace, podName, 0); err != nil {
		return fmt.Errorf("deleting naked pod %s/%s for SDK injection: %w", namespace, podName, err)
	}
	if err := e.container.k8sClient.createPod(namespace, pod); err != nil {
		e.logger.Error("naked pod create failed after delete, attempting rollback with original spec", zap.String("namespace", namespace), zap.String("pod", podName), zap.Error(err))
		var originalPod map[string]any
		if unmarshalErr := json.Unmarshal(originalPodJSON, &originalPod); unmarshalErr == nil {
			stripPodRuntimeFields(originalPod)
			_ = e.container.k8sClient.createPod(namespace, originalPod)
		}
		return fmt.Errorf("recreating naked pod %s/%s with SDK: %w", namespace, podName, err)
	}
	e.setAgentObservabilityState(svc.ID, "enabled", "controller_managed", "", fmt.Sprintf("OpenLIT SDK injected via naked pod %s/%s recreate (workload %s)", namespace, podName, svc.WorkloadKey))
	return nil
}

func (e *Engine) disableNodeJSSDKNakedPod(svc *openlit.ServiceState) error {
	namespace := svc.ResourceAttributes["k8s.namespace.name"]
	podName := svc.ResourceAttributes["k8s.pod.name"]
	containerName := svc.ResourceAttributes["container.name"]
	if namespace == "" || podName == "" {
		return fmt.Errorf("missing pod metadata for naked pod %s", svc.ServiceName)
	}
	pod, err := e.container.k8sClient.getPod(namespace, podName)
	if err != nil {
		return fmt.Errorf("fetching naked pod %s/%s: %w", namespace, podName, err)
	}
	spec, _ := pod["spec"].(map[string]any)
	if spec == nil {
		return fmt.Errorf("pod %s/%s has no spec", namespace, podName)
	}
	containers, err := extractContainers(spec["containers"])
	if err != nil {
		return err
	}
	targetIndex, err := selectContainerIndex(containers, containerName)
	if err != nil {
		return err
	}
	removeNodeJSSDKContainerSettings(containers[targetIndex])
	spec["initContainers"] = objectSliceToAny(removeNamedObject(extractObjectSlice(spec["initContainers"]), openlitInstrumentationInitName))
	spec["volumes"] = objectSliceToAny(removeNamedObject(extractObjectSlice(spec["volumes"]), openlitInstrumentationVolume))
	spec["containers"] = objectSliceToAny(containers)
	metadata, _ := pod["metadata"].(map[string]any)
	annotations := copyStringMap(metadata["annotations"])
	removeManagedSDKAnnotations(annotations)
	stripPodRuntimeFields(pod)
	if metaMap, ok := pod["metadata"].(map[string]any); ok {
		metaMap["annotations"] = stringMapToAny(annotations)
	}
	originalPodJSON, _ := json.Marshal(pod)
	if err := e.container.k8sClient.deletePod(namespace, podName, 0); err != nil {
		return fmt.Errorf("deleting naked pod %s/%s for SDK removal: %w", namespace, podName, err)
	}
	if err := e.container.k8sClient.createPod(namespace, pod); err != nil {
		var originalPod map[string]any
		if unmarshalErr := json.Unmarshal(originalPodJSON, &originalPod); unmarshalErr == nil {
			stripPodRuntimeFields(originalPod)
			_ = e.container.k8sClient.createPod(namespace, originalPod)
		}
		return fmt.Errorf("recreating naked pod %s/%s without SDK: %w", namespace, podName, err)
	}
	e.setAgentObservabilityState(svc.ID, "disabled", "none", "", fmt.Sprintf("OpenLIT SDK removed via naked pod %s/%s recreate (workload %s)", namespace, podName, svc.WorkloadKey))
	return nil
}

func buildNodeJSSDKWorkloadPatch(workload map[string]any, containerName string, svc *openlit.ServiceState, payload openlit.SDKActionPayload, enable bool) (map[string]any, error) {
	template, err := getTemplate(workload)
	if err != nil {
		return nil, err
	}
	templateMeta := ensureMap(template, "metadata")
	templateSpec := ensureMap(template, "spec")
	annotations := copyStringMap(templateMeta["annotations"])
	if enable {
		setManagedSDKAnnotations(annotations, svc, payload, nodeSDKRuntime)
	} else {
		removeManagedSDKAnnotations(annotations)
	}
	containers, err := extractContainers(templateSpec["containers"])
	if err != nil {
		return nil, err
	}
	targetIndex, err := selectContainerIndex(containers, containerName)
	if err != nil {
		return nil, err
	}
	if enable {
		appImage := resolveContainerImage(containers, containerName)
		if appImage == "" {
			return nil, fmt.Errorf("cannot resolve image for container %q", containerName)
		}
		if err := applyNodeJSSDKContainerSettings(containers[targetIndex], svc, payload); err != nil {
			return nil, err
		}
		initContainer := map[string]any{
			"name":    openlitInstrumentationInitName,
			"image":   appImage,
			"command": []any{"sh", "-c", buildNPMInstallShellCmd(openlitInstrumentationMountPath, payload.SDKVersion)},
			"volumeMounts": []any{map[string]any{
				"name":      openlitInstrumentationVolume,
				"mountPath": openlitInstrumentationMountPath,
			}},
		}
		if policy := resolveContainerImagePullPolicy(containers, containerName); policy != "" {
			initContainer["imagePullPolicy"] = policy
		}
		templateSpec["initContainers"] = objectSliceToAny(upsertNamedObject(extractObjectSlice(templateSpec["initContainers"]), openlitInstrumentationInitName, initContainer))
		templateSpec["volumes"] = objectSliceToAny(upsertNamedObject(extractObjectSlice(templateSpec["volumes"]), openlitInstrumentationVolume, map[string]any{
			"name":     openlitInstrumentationVolume,
			"emptyDir": map[string]any{},
		}))
	} else {
		removeNodeJSSDKContainerSettings(containers[targetIndex])
		templateSpec["initContainers"] = objectSliceToAny(removeNamedObject(extractObjectSlice(templateSpec["initContainers"]), openlitInstrumentationInitName))
		templateSpec["volumes"] = objectSliceToAny(removeNamedObject(extractObjectSlice(templateSpec["volumes"]), openlitInstrumentationVolume))
	}
	templateSpec["containers"] = objectSliceToAny(containers)
	return map[string]any{
		"spec": map[string]any{
			"template": map[string]any{
				"metadata": map[string]any{"annotations": annotations},
				"spec":     templateSpec,
			},
		},
	}, nil
}

func applyNodeJSSDKContainerSettings(container map[string]any, svc *openlit.ServiceState, payload openlit.SDKActionPayload) error {
	env := extractObjectSlice(container["env"])
	nodeOptions, err := upsertNodeOptionsInK8sEnv(env, k8sManagedNodeRegisterPath())
	if err != nil {
		return err
	}
	env = nodeOptions
	env = appendCommonSDKK8sEnv(env, svc, payload, strings.Join(controllerManagedNodeDisabledInstrumentors, ","))
	container["env"] = objectSliceToAny(env)
	volumeMounts := extractObjectSlice(container["volumeMounts"])
	volumeMounts = upsertNamedObject(volumeMounts, openlitInstrumentationVolume, map[string]any{
		"name":      openlitInstrumentationVolume,
		"mountPath": openlitInstrumentationMountPath,
	})
	container["volumeMounts"] = objectSliceToAny(volumeMounts)
	return nil
}

func removeNodeJSSDKContainerSettings(container map[string]any) {
	env := extractObjectSlice(container["env"])
	env = removeCommonSDKK8sEnv(env)
	env = removeNodeOptionsFromK8sEnv(env, k8sManagedNodeRegisterPath())
	container["env"] = objectSliceToAny(env)
	volumeMounts := removeNamedObject(extractObjectSlice(container["volumeMounts"]), openlitInstrumentationVolume)
	container["volumeMounts"] = objectSliceToAny(volumeMounts)
}

func appendCommonSDKK8sEnv(env []map[string]any, svc *openlit.ServiceState, payload openlit.SDKActionPayload, disabledInstrumentors string) []map[string]any {
	env = upsertEnvValue(env, "OPENLIT_CONTROLLER_MODE", controllerManagedAgentMode)
	env = upsertEnvValue(env, "OTEL_SERVICE_NAME", svc.ServiceName)
	env = upsertEnvValue(env, "OTEL_EXPORTER_OTLP_ENDPOINT", payload.OTLPEndpoint)
	env = upsertEnvValue(env, "OTEL_DEPLOYMENT_ENVIRONMENT", payload.Environment)
	if svc.WorkloadKey != "" {
		env = mergeOtelResourceAttrInK8sEnv(env, "service.workload.key", svc.WorkloadKey)
	}
	if payload.OTLPProtocol != "" {
		env = upsertEnvValue(env, "OTEL_EXPORTER_OTLP_PROTOCOL", payload.OTLPProtocol)
	}
	if payload.OTLPTracesEndpoint != "" {
		env = upsertEnvValue(env, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", payload.OTLPTracesEndpoint)
	}
	if payload.OTLPMetricsEndpoint != "" {
		env = upsertEnvValue(env, "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", payload.OTLPMetricsEndpoint)
	}
	if payload.OTLPLogsEndpoint != "" {
		env = upsertEnvValue(env, "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", payload.OTLPLogsEndpoint)
	}
	if len(payload.OTLPHeaders) > 0 {
		env = upsertEnvValue(env, "OTEL_EXPORTER_OTLP_HEADERS", formatOTLPHeaders(payload.OTLPHeaders))
	}
	env = upsertEnvValue(env, "OPENLIT_DISABLED_INSTRUMENTORS", disabledInstrumentors)
	return env
}

func removeCommonSDKK8sEnv(env []map[string]any) []map[string]any {
	for _, key := range []string{
		"OPENLIT_CONTROLLER_MODE",
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OTEL_EXPORTER_OTLP_PROTOCOL",
		"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
		"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_HEADERS",
		"OTEL_DEPLOYMENT_ENVIRONMENT",
		"OPENLIT_DISABLED_INSTRUMENTORS",
	} {
		env = removeEnvValue(env, key)
	}
	return removeOtelResourceAttrFromK8sEnv(env, "service.workload.key")
}

func (e *Engine) enableNodeJSSDKDocker(svc *openlit.ServiceState, payload openlit.SDKActionPayload) error {
	if e.container == nil || e.container.dockerClient == nil || !e.container.dockerClient.canManage() {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", "Docker Agent Observability requires a writable Docker socket and a Docker-capable controller")
		return fmt.Errorf("docker controller does not have writable Docker API access")
	}
	containerID := svc.ResourceAttributes["container.id"]
	if containerID == "" {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", "Docker container metadata is missing for this workload")
		return fmt.Errorf("missing docker container id for %s", svc.ServiceName)
	}
	inspect, err := e.container.dockerClient.inspectContainer(containerID)
	if err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to inspect Docker container: %v", err))
		return err
	}
	preflight := evaluateNodeJSSDKPreflight(dockerInspectEnv(inspect), dockerInspectCommand(inspect), payload.DuplicatePolicy)
	if err := e.applySDKPreflightResult(svc.ID, preflight); err != nil {
		return err
	}
	if preflight.Decision == pythonSDKDecisionAdopt {
		return nil
	}
	if err := ensureDockerContainerManageable(inspect); err != nil {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", err.Error())
		return err
	}
	volumeName := dockerNodeSDKVolumeName(svc)
	if err := e.prepareDockerNodeSDKVolume(inspect, svc, volumeName, payload.SDKVersion); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", err.Error())
		return err
	}
	payloadMap, err := buildDockerNodeJSContainerCreatePayload(inspect, svc, payload, volumeName, true)
	if err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to build container config: %v", err))
		return err
	}
	if err := e.recreateDockerContainer(inspect, payloadMap); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", err.Error())
		return err
	}
	e.setAgentObservabilityState(svc.ID, "enabled", "controller_managed", "", fmt.Sprintf("OpenLIT SDK active via Docker container recreate (workload %s)", svc.WorkloadKey))
	return nil
}

func (e *Engine) disableNodeJSSDKDocker(svc *openlit.ServiceState) error {
	if e.container == nil || e.container.dockerClient == nil || !e.container.dockerClient.canManage() {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", "Docker Agent Observability requires a writable Docker socket and a Docker-capable controller")
		return fmt.Errorf("docker controller does not have writable Docker API access")
	}
	containerID := svc.ResourceAttributes["container.id"]
	if containerID == "" {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", "Docker container metadata is missing for this workload")
		return fmt.Errorf("missing docker container id for %s", svc.ServiceName)
	}
	inspect, err := e.container.dockerClient.inspectContainer(containerID)
	if err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to inspect Docker container: %v", err))
		return err
	}
	volumeName := dockerNodeSDKVolumeName(svc)
	payloadMap, err := buildDockerNodeJSContainerCreatePayload(inspect, svc, openlit.SDKActionPayload{}, volumeName, false)
	if err != nil {
		return err
	}
	if err := e.recreateDockerContainer(inspect, payloadMap); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", err.Error())
		return err
	}
	_ = e.container.dockerClient.removeVolume(volumeName)
	e.setAgentObservabilityState(svc.ID, "disabled", "none", "", fmt.Sprintf("OpenLIT SDK removed via Docker container recreate (workload %s)", svc.WorkloadKey))
	return nil
}

func (e *Engine) prepareDockerNodeSDKVolume(inspect map[string]any, svc *openlit.ServiceState, volumeName string, sdkVersion string) error {
	if err := e.container.dockerClient.createVolume(volumeName, map[string]string{
		openlitManagedLabel:       "true",
		openlitManagedVolumeLabel: svc.WorkloadKey,
	}); err != nil {
		return err
	}
	image := dockerInspectImage(inspect)
	if image == "" {
		return fmt.Errorf("docker sdk preparation requires image metadata")
	}
	helperPayload := map[string]any{
		"Image":      image,
		"Entrypoint": []any{"sh"},
		"Cmd":        []any{"-c", buildNPMInstallShellCmd(openlitInstrumentationMountPath, sdkVersion)},
		"HostConfig": map[string]any{
			"Binds":       []any{fmt.Sprintf("%s:%s", volumeName, openlitInstrumentationMountPath)},
			"NetworkMode": dockerInspectHostConfigValue(inspect, "NetworkMode"),
		},
	}
	helperName := "openlit-nodejs-sdk-installer-" + shortHash(svc.WorkloadKey+time.Now().String())
	helperID, err := e.container.dockerClient.createContainer(helperName, helperPayload)
	if err != nil {
		return err
	}
	defer func() { _ = e.container.dockerClient.removeContainer(helperID, true) }()
	if err := e.container.dockerClient.startContainer(helperID); err != nil {
		return err
	}
	statusCode, err := e.container.dockerClient.waitContainer(helperID)
	if err != nil {
		return err
	}
	if statusCode != 0 {
		return fmt.Errorf("docker sdk installer exited with status %d", statusCode)
	}
	return nil
}

func buildDockerNodeJSContainerCreatePayload(inspect map[string]any, svc *openlit.ServiceState, payload openlit.SDKActionPayload, volumeName string, enable bool) (map[string]any, error) {
	configMap := dockerInspectConfig(inspect)
	if configMap == nil {
		return nil, fmt.Errorf("docker container config missing")
	}
	hostConfig := cloneMap(dockerInspectHostConfig(inspect))
	networkingConfig := dockerInspectNetworkingConfig(inspect)
	createPayload := map[string]any{}
	copySelectedKeys(createPayload, configMap, []string{
		"Hostname", "Domainname", "User", "AttachStdin", "AttachStdout", "AttachStderr",
		"ExposedPorts", "Tty", "OpenStdin", "StdinOnce", "Env", "Cmd", "Healthcheck",
		"ArgsEscaped", "Image", "Volumes", "WorkingDir", "Entrypoint", "NetworkDisabled",
		"MacAddress", "Labels", "StopSignal", "StopTimeout", "Shell",
	})
	envValues := extractStringList(createPayload["Env"])
	if enable {
		envValues = upsertEnvString(envValues, "NODE_OPTIONS", prependNodeRequireOption(envValue(envValues, "NODE_OPTIONS"), dockerManagedNodeRegisterPath()))
		envValues = appendCommonSDKEnvStrings(envValues, svc, payload, strings.Join(controllerManagedNodeDisabledInstrumentors, ","))
		labels := extractStringMap(createPayload["Labels"])
		labels[openlitManagedLabel] = "true"
		labels[openlitManagedVolumeLabel] = volumeName
		labels[openlitManagedConfigHash] = sdkConfigHash(svc, payload, nodeSDKRuntime)
		createPayload["Labels"] = labels
		hostConfig["Binds"] = upsertBindMount(extractStringList(hostConfig["Binds"]), fmt.Sprintf("%s:%s", volumeName, openlitInstrumentationMountPath), openlitInstrumentationMountPath)
	} else {
		envValues = removeCommonSDKEnvStrings(envValues)
		envValues = removeNodeOptionsFromEnvStrings(envValues, dockerManagedNodeRegisterPath())
		labels := extractStringMap(createPayload["Labels"])
		delete(labels, openlitManagedLabel)
		delete(labels, openlitManagedVolumeLabel)
		delete(labels, openlitManagedConfigHash)
		createPayload["Labels"] = labels
		hostConfig["Binds"] = removeBindMount(extractStringList(hostConfig["Binds"]), openlitInstrumentationMountPath)
	}
	createPayload["Env"] = stringSliceToAny(envValues)
	createPayload["HostConfig"] = hostConfig
	if len(networkingConfig) > 0 {
		createPayload["NetworkingConfig"] = networkingConfig
	}
	return createPayload, nil
}

func (e *Engine) enableNodeJSSDKLinux(svc *openlit.ServiceState, payload openlit.SDKActionPayload) error {
	if !linuxSystemdSDKSupported() {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", "Linux Agent Observability requires systemd and root-level unit management access")
		return fmt.Errorf("linux controller does not have systemd management support")
	}
	unit := svc.ResourceAttributes["systemd.unit"]
	if unit == "" {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", "This Linux workload is not managed by systemd")
		return fmt.Errorf("linux workload %s is not systemd-managed", svc.ServiceName)
	}
	if svc.ResourceAttributes["systemd.scope"] == "user" {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", "User-scoped systemd services are not supported yet")
		return fmt.Errorf("user-scoped systemd unit %s is not supported", unit)
	}
	preflight := evaluateNodeJSSDKPreflight(readEnviron(e.procRoot, svc.PID), strings.Fields(svc.Cmdline), payload.DuplicatePolicy)
	if err := e.applySDKPreflightResult(svc.ID, preflight); err != nil {
		return err
	}
	if preflight.Decision == pythonSDKDecisionAdopt {
		return nil
	}
	sdkRoot := filepath.Join(nodeSystemdSDKStateDir, sanitizeSystemdUnit(unit))
	if err := installNodeSDKFromNPM(sdkRoot, payload.SDKVersion); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", err.Error())
		return err
	}
	env := readEnviron(e.procRoot, svc.PID)
	dropIn := buildNodeSystemdDropInContent(unit, sdkRoot, svc.ServiceName, svc.WorkloadKey, payload, strings.Join(controllerManagedNodeDisabledInstrumentors, ","), env["NODE_OPTIONS"], sdkConfigHash(svc, payload, nodeSDKRuntime))
	if err := writeSystemdDropIn(unit, dropIn); err != nil {
		return err
	}
	if err := runSystemctl("daemon-reload"); err != nil {
		_ = removeSystemdDropIn(unit)
		return err
	}
	if err := runSystemctl("try-restart", unit); err != nil {
		_ = removeSystemdDropIn(unit)
		_ = runSystemctl("daemon-reload")
		return err
	}
	e.setAgentObservabilityState(svc.ID, "enabled", "controller_managed", "", fmt.Sprintf("OpenLIT SDK active via systemd drop-in (unit %s)", unit))
	return nil
}

func (e *Engine) disableNodeJSSDKLinux(svc *openlit.ServiceState) error {
	if !linuxSystemdSDKSupported() {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", "Linux Agent Observability requires systemd and root-level unit management access")
		return fmt.Errorf("linux controller does not have systemd management support")
	}
	unit := svc.ResourceAttributes["systemd.unit"]
	if unit == "" {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", "This Linux workload is not managed by systemd")
		return fmt.Errorf("linux workload %s is not systemd-managed", svc.ServiceName)
	}
	if err := removeSystemdDropIn(unit); err != nil {
		return err
	}
	if err := runSystemctl("daemon-reload"); err != nil {
		return err
	}
	if err := runSystemctl("try-restart", unit); err != nil {
		return err
	}
	e.setAgentObservabilityState(svc.ID, "disabled", "none", "", fmt.Sprintf("OpenLIT SDK removed via systemd drop-in (unit %s)", unit))
	return nil
}

func (e *Engine) enableNodeJSSDKBareProcess(svc *openlit.ServiceState, payload openlit.SDKActionPayload) error {
	preflight := evaluateNodeJSSDKPreflight(readEnviron(e.procRoot, svc.PID), strings.Fields(svc.Cmdline), payload.DuplicatePolicy)
	if err := e.applySDKPreflightResult(svc.ID, preflight); err != nil {
		return err
	}
	if preflight.Decision == pythonSDKDecisionAdopt {
		return nil
	}
	fingerprint := shortHash(svc.WorkloadKey)
	sdkRoot := filepath.Join(nodeBareProcessSDKStateDir, fingerprint)
	if err := installNodeSDKFromNPM(sdkRoot, payload.SDKVersion); err != nil {
		e.setDesiredAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to install OpenLIT SDK: %v", err))
		return err
	}
	existingEnv := readEnviron(e.procRoot, svc.PID)
	nodeOptions := prependNodeRequireOption(existingEnv["NODE_OPTIONS"], bareManagedNodeRegisterPath(sdkRoot))
	envOverrides := map[string]string{
		"NODE_OPTIONS":                   nodeOptions,
		"OPENLIT_CONTROLLER_MODE":        controllerManagedAgentMode,
		"OTEL_SERVICE_NAME":              svc.ServiceName,
		"OTEL_EXPORTER_OTLP_ENDPOINT":    payload.OTLPEndpoint,
		"OTEL_DEPLOYMENT_ENVIRONMENT":    payload.Environment,
		"OPENLIT_DISABLED_INSTRUMENTORS": strings.Join(controllerManagedNodeDisabledInstrumentors, ","),
	}
	if svc.WorkloadKey != "" {
		envOverrides["OTEL_RESOURCE_ATTRIBUTES"] = mergeResourceAttrValue(existingEnv["OTEL_RESOURCE_ATTRIBUTES"], "service.workload.key", svc.WorkloadKey)
	}
	applyOTLPEnvOverrides(envOverrides, payload)
	newPID, err := restartProcessWithEnv(e.procRoot, svc.PID, envOverrides)
	if err != nil {
		manualReason := fmt.Sprintf(
			"OpenLIT SDK installed at %s. To activate, set these environment variables and restart your process:\n"+
				"  NODE_OPTIONS=\"--require %s $NODE_OPTIONS\"\n"+
				"  OPENLIT_CONTROLLER_MODE=agent_observability\n"+
				"  OTEL_SERVICE_NAME=%s\n"+
				"  OTEL_EXPORTER_OTLP_ENDPOINT=%s\n"+
				"  OTEL_DEPLOYMENT_ENVIRONMENT=%s\n"+
				"  OPENLIT_DISABLED_INSTRUMENTORS=%s",
			sdkRoot,
			bareManagedNodeRegisterPath(sdkRoot),
			svc.ServiceName,
			payload.OTLPEndpoint,
			payload.Environment,
			strings.Join(controllerManagedNodeDisabledInstrumentors, ","),
		)
		e.setDesiredAgentObservabilityState(svc.ID, "manual", "controller_managed", "", manualReason)
		return nil
	}
	e.mu.Lock()
	if s, ok := e.services[svc.ID]; ok {
		s.PID = newPID
	}
	e.mu.Unlock()
	e.setDesiredAgentObservabilityState(svc.ID, "enabled", "controller_managed", "", fmt.Sprintf("OpenLIT SDK active via process restart (PID %d -> %d)", svc.PID, newPID))
	return nil
}

func (e *Engine) disableNodeJSSDKBareProcess(svc *openlit.ServiceState) error {
	fingerprint := shortHash(svc.WorkloadKey)
	sdkRoot := filepath.Join(nodeBareProcessSDKStateDir, fingerprint)
	existingEnv := readEnviron(e.procRoot, svc.PID)
	if existingEnv == nil {
		existingEnv = make(map[string]string)
	}
	for _, key := range []string{
		"OPENLIT_CONTROLLER_MODE",
		"OTEL_SERVICE_NAME",
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OTEL_EXPORTER_OTLP_PROTOCOL",
		"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
		"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_HEADERS",
		"OTEL_DEPLOYMENT_ENVIRONMENT",
		"OPENLIT_DISABLED_INSTRUMENTORS",
	} {
		delete(existingEnv, key)
	}
	if filtered := removeNodeRequireOption(existingEnv["NODE_OPTIONS"], bareManagedNodeRegisterPath(sdkRoot)); filtered == "" {
		delete(existingEnv, "NODE_OPTIONS")
	} else {
		existingEnv["NODE_OPTIONS"] = filtered
	}
	if existing := existingEnv["OTEL_RESOURCE_ATTRIBUTES"]; existing != "" {
		if filtered := removeResourceAttrKey(existing, "service.workload.key"); filtered == "" {
			delete(existingEnv, "OTEL_RESOURCE_ATTRIBUTES")
		} else {
			existingEnv["OTEL_RESOURCE_ATTRIBUTES"] = filtered
		}
	}
	newPID, err := restartProcess(e.procRoot, svc.PID, existingEnv)
	if err != nil {
		e.setDesiredAgentObservabilityState(svc.ID, "disabled", "none", "", "Agent O11y disabled. Remove the OpenLIT --require entry from NODE_OPTIONS and restart the process.")
	} else {
		e.mu.Lock()
		if s, ok := e.services[svc.ID]; ok {
			s.PID = newPID
		}
		e.mu.Unlock()
		e.setDesiredAgentObservabilityState(svc.ID, "disabled", "none", "", fmt.Sprintf("Agent O11y disabled via process restart (PID %d -> %d)", svc.PID, newPID))
	}
	_ = os.RemoveAll(sdkRoot)
	return nil
}

func (e *Engine) applySDKPreflightResult(serviceID string, preflight pythonSDKPreflightResult) error {
	if preflight.Decision == pythonSDKDecisionBlock {
		e.setAgentObservabilityState(serviceID, "conflict", preflight.Source, preflight.Conflict, preflight.Reason)
		return fmt.Errorf("%s", preflight.Reason)
	}
	if preflight.Decision == pythonSDKDecisionAdopt {
		e.setAgentObservabilityState(serviceID, "enabled", preflight.Source, "", preflight.Reason)
	}
	return nil
}

func evaluateNodeJSSDKPreflight(env map[string]string, command []string, duplicatePolicy string) pythonSDKPreflightResult {
	lowerCommand := strings.ToLower(strings.Join(command, " "))
	nodeOptions := env["NODE_OPTIONS"]
	isControllerManaged := strings.EqualFold(env["OPENLIT_CONTROLLER_MODE"], controllerManagedAgentMode) ||
		strings.Contains(nodeOptions, openlitInstrumentationMountPath) ||
		strings.Contains(nodeOptions, nodeOpenLITRegisterModule)
	if isControllerManaged {
		return pythonSDKPreflightResult{Decision: pythonSDKDecisionAdopt, Source: "controller_managed", Reason: "Existing controller-managed OpenLIT JavaScript/TypeScript SDK configuration detected"}
	}
	if containsOpenLITNodeRequire(command) || containsOpenLITNodeRequire(strings.Fields(nodeOptions)) ||
		env["OPENLIT_DISABLED_INSTRUMENTORS"] != "" || env["OPENLIT_DISABLE_METRICS"] != "" ||
		env["OPENLIT_DISABLE_EVENTS"] != "" || strings.Contains(lowerCommand, "openlit") {
		return pythonSDKPreflightResult{Decision: pythonSDKDecisionAdopt, Source: "existing_openlit", Reason: "Existing OpenLIT JavaScript/TypeScript SDK configuration detected and adopted"}
	}
	hasExistingOTel := containsOTelNodeRequire(command) || containsOTelNodeRequire(strings.Fields(nodeOptions)) ||
		env["OTEL_NODE_RESOURCE_DETECTORS"] != "" ||
		env["OTEL_NODE_ENABLED_INSTRUMENTATIONS"] != "" ||
		env["OTEL_NODE_DISABLED_INSTRUMENTATIONS"] != "" ||
		env["OTEL_TRACES_EXPORTER"] != "" ||
		env["OTEL_METRICS_EXPORTER"] != "" ||
		env["OTEL_LOGS_EXPORTER"] != "" ||
		strings.Contains(lowerCommand, "@opentelemetry")
	if hasExistingOTel && duplicatePolicy == defaultDuplicatePolicy {
		return pythonSDKPreflightResult{Decision: pythonSDKDecisionBlock, Source: "existing_otel", Conflict: "existing_otel", Reason: "Existing OpenTelemetry Node.js instrumentation detected on target workload"}
	}
	return pythonSDKPreflightResult{Decision: pythonSDKDecisionApply, Source: "controller_managed", Reason: "Controller-managed OpenLIT JavaScript/TypeScript SDK will be applied"}
}

func containsOpenLITNodeRequire(args []string) bool {
	return argsContainRequireModule(args, func(module string) bool {
		m := strings.ToLower(module)
		return strings.Contains(m, "openlit/register") || strings.Contains(m, "openlit/dist/register")
	})
}

func containsOTelNodeRequire(args []string) bool {
	return argsContainRequireModule(args, func(module string) bool {
		m := strings.ToLower(module)
		return strings.Contains(m, nodeOTelAutoRegisterModule) || strings.Contains(m, nodeOTelSDKModule)
	})
}

func argsContainRequireModule(args []string, match func(string) bool) bool {
	for i, arg := range args {
		if arg == "--require" || arg == "-r" {
			if i+1 < len(args) && match(args[i+1]) {
				return true
			}
			continue
		}
		for _, prefix := range []string{"--require=", "-r="} {
			if strings.HasPrefix(arg, prefix) && match(strings.TrimPrefix(arg, prefix)) {
				return true
			}
		}
	}
	return false
}

func k8sManagedNodeRegisterPath() string {
	return filepath.Join(openlitInstrumentationMountPath, nodeSDKDirName, nodeSDKRegisterRelPath)
}

func dockerManagedNodeRegisterPath() string {
	return k8sManagedNodeRegisterPath()
}

func bareManagedNodeRegisterPath(sdkRoot string) string {
	return filepath.Join(sdkRoot, nodeSDKRegisterRelPath)
}

func dockerNodeSDKVolumeName(svc *openlit.ServiceState) string {
	return "openlit-nodejs-sdk-" + shortHash(svc.WorkloadKey)
}

func isNodeRuntime(runtime string) bool {
	r := strings.ToLower(runtime)
	return r == "nodejs" || r == "node" || strings.Contains(r, "javascript") || strings.Contains(r, "typescript")
}

func envValue(env []string, key string) string {
	for _, entry := range env {
		k, v, ok := strings.Cut(entry, "=")
		if ok && k == key {
			return v
		}
	}
	return ""
}

func prependNodeRequireOption(existing, requirePath string) string {
	return strings.TrimSpace("--require " + requirePath + " " + removeNodeRequireOption(existing, requirePath))
}

func removeNodeRequireOption(existing, requirePath string) string {
	if existing == "" {
		return ""
	}
	parts := strings.Fields(existing)
	out := make([]string, 0, len(parts))
	for i := 0; i < len(parts); i++ {
		part := parts[i]
		if (part == "--require" || part == "-r") && i+1 < len(parts) {
			if parts[i+1] == requirePath {
				i++
				continue
			}
			out = append(out, part, parts[i+1])
			i++
			continue
		}
		if part == "--require="+requirePath || part == "-r="+requirePath {
			continue
		}
		out = append(out, part)
	}
	return strings.Join(out, " ")
}

func removeNodeOptionsFromEnvStrings(env []string, requirePath string) []string {
	for i, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if !ok || key != "NODE_OPTIONS" {
			continue
		}
		filtered := removeNodeRequireOption(value, requirePath)
		if filtered == "" {
			return append(env[:i], env[i+1:]...)
		}
		env[i] = "NODE_OPTIONS=" + filtered
		return env
	}
	return env
}

func removeNodeOptionsFromK8sEnv(env []map[string]any, requirePath string) []map[string]any {
	for i, item := range env {
		if item["name"] != "NODE_OPTIONS" {
			continue
		}
		value, _ := item["value"].(string)
		filtered := removeNodeRequireOption(value, requirePath)
		if filtered == "" {
			return append(env[:i], env[i+1:]...)
		}
		item["value"] = filtered
		env[i] = item
		return env
	}
	return env
}

func upsertNodeOptionsInK8sEnv(env []map[string]any, requirePath string) ([]map[string]any, error) {
	for index, item := range env {
		if item["name"] != "NODE_OPTIONS" {
			continue
		}
		if _, hasValueFrom := item["valueFrom"]; hasValueFrom {
			return nil, fmt.Errorf("NODE_OPTIONS uses valueFrom and cannot be safely rewritten")
		}
		existing, _ := item["value"].(string)
		env[index]["value"] = prependNodeRequireOption(existing, requirePath)
		return env, nil
	}
	return append(env, map[string]any{"name": "NODE_OPTIONS", "value": prependNodeRequireOption("", requirePath)}), nil
}

func appendCommonSDKEnvStrings(envValues []string, svc *openlit.ServiceState, payload openlit.SDKActionPayload, disabledInstrumentors string) []string {
	envValues = upsertEnvString(envValues, "OPENLIT_CONTROLLER_MODE", controllerManagedAgentMode)
	envValues = upsertEnvString(envValues, "OTEL_SERVICE_NAME", svc.ServiceName)
	envValues = upsertEnvString(envValues, "OTEL_EXPORTER_OTLP_ENDPOINT", payload.OTLPEndpoint)
	envValues = upsertEnvString(envValues, "OTEL_DEPLOYMENT_ENVIRONMENT", payload.Environment)
	if svc.WorkloadKey != "" {
		envValues = mergeOtelResourceAttrInEnvString(envValues, "service.workload.key", svc.WorkloadKey)
	}
	if payload.OTLPProtocol != "" {
		envValues = upsertEnvString(envValues, "OTEL_EXPORTER_OTLP_PROTOCOL", payload.OTLPProtocol)
	}
	if payload.OTLPTracesEndpoint != "" {
		envValues = upsertEnvString(envValues, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", payload.OTLPTracesEndpoint)
	}
	if payload.OTLPMetricsEndpoint != "" {
		envValues = upsertEnvString(envValues, "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", payload.OTLPMetricsEndpoint)
	}
	if payload.OTLPLogsEndpoint != "" {
		envValues = upsertEnvString(envValues, "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", payload.OTLPLogsEndpoint)
	}
	if len(payload.OTLPHeaders) > 0 {
		envValues = upsertEnvString(envValues, "OTEL_EXPORTER_OTLP_HEADERS", formatOTLPHeaders(payload.OTLPHeaders))
	}
	return upsertEnvString(envValues, "OPENLIT_DISABLED_INSTRUMENTORS", disabledInstrumentors)
}

func removeCommonSDKEnvStrings(envValues []string) []string {
	for _, key := range []string{
		"OPENLIT_CONTROLLER_MODE",
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OTEL_EXPORTER_OTLP_PROTOCOL",
		"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
		"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_HEADERS",
		"OTEL_DEPLOYMENT_ENVIRONMENT",
		"OPENLIT_DISABLED_INSTRUMENTORS",
	} {
		envValues = removeEnvString(envValues, key)
	}
	return removeOtelResourceAttrFromEnvString(envValues, "service.workload.key")
}

func applyOTLPEnvOverrides(env map[string]string, payload openlit.SDKActionPayload) {
	if payload.OTLPProtocol != "" {
		env["OTEL_EXPORTER_OTLP_PROTOCOL"] = payload.OTLPProtocol
	}
	if payload.OTLPTracesEndpoint != "" {
		env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] = payload.OTLPTracesEndpoint
	}
	if payload.OTLPMetricsEndpoint != "" {
		env["OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"] = payload.OTLPMetricsEndpoint
	}
	if payload.OTLPLogsEndpoint != "" {
		env["OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"] = payload.OTLPLogsEndpoint
	}
	if len(payload.OTLPHeaders) > 0 {
		env["OTEL_EXPORTER_OTLP_HEADERS"] = formatOTLPHeaders(payload.OTLPHeaders)
	}
}

func buildNodeSystemdDropInContent(unit, sdkRoot, serviceName, workloadKey string, payload openlit.SDKActionPayload, disabledInstrumentors, existingNodeOptions, configHash string) string {
	registerPath := bareManagedNodeRegisterPath(sdkRoot)
	nodeOptions := prependNodeRequireOption(existingNodeOptions, registerPath)
	var buf strings.Builder
	buf.WriteString("[Service]\n")
	buf.WriteString(fmt.Sprintf("# openlit-managed-unit=%s\n", unit))
	buf.WriteString(fmt.Sprintf("# openlit-managed-config-hash=%s\n", configHash))
	buf.WriteString(fmt.Sprintf("Environment=\"NODE_OPTIONS=%s\"\n", escapeSystemdValue(nodeOptions)))
	buf.WriteString("Environment=\"OPENLIT_CONTROLLER_MODE=agent_observability\"\n")
	buf.WriteString(fmt.Sprintf("Environment=\"OTEL_SERVICE_NAME=%s\"\n", escapeSystemdValue(serviceName)))
	if workloadKey != "" {
		buf.WriteString(fmt.Sprintf("Environment=\"OTEL_RESOURCE_ATTRIBUTES=service.workload.key=%s\"\n", escapeSystemdValue(workloadKey)))
	}
	buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_ENDPOINT=%s\"\n", escapeSystemdValue(payload.OTLPEndpoint)))
	buf.WriteString(fmt.Sprintf("Environment=\"OTEL_DEPLOYMENT_ENVIRONMENT=%s\"\n", escapeSystemdValue(payload.Environment)))
	if payload.OTLPProtocol != "" {
		buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_PROTOCOL=%s\"\n", escapeSystemdValue(payload.OTLPProtocol)))
	}
	if payload.OTLPTracesEndpoint != "" {
		buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=%s\"\n", escapeSystemdValue(payload.OTLPTracesEndpoint)))
	}
	if payload.OTLPMetricsEndpoint != "" {
		buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=%s\"\n", escapeSystemdValue(payload.OTLPMetricsEndpoint)))
	}
	if payload.OTLPLogsEndpoint != "" {
		buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=%s\"\n", escapeSystemdValue(payload.OTLPLogsEndpoint)))
	}
	if len(payload.OTLPHeaders) > 0 {
		buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_HEADERS=%s\"\n", escapeSystemdValue(formatOTLPHeaders(payload.OTLPHeaders))))
	}
	buf.WriteString(fmt.Sprintf("Environment=\"OPENLIT_DISABLED_INSTRUMENTORS=%s\"\n", escapeSystemdValue(disabledInstrumentors)))
	return buf.String()
}

func setManagedSDKAnnotations(annotations map[string]string, svc *openlit.ServiceState, payload openlit.SDKActionPayload, runtime string) {
	annotations[openlitManagedAnnotation] = "true"
	annotations[openlitManagedProfileAnnotation] = controllerManagedObservability
	annotations[openlitManagedConfigHash] = sdkConfigHash(svc, payload, runtime)
	annotations["openlit.io/sdk-runtime"] = runtime
	versionLabel := payload.SDKVersion
	if versionLabel == "" {
		versionLabel = "latest"
	}
	annotations[openlitManagedSDKVersion] = versionLabel
}

func removeManagedSDKAnnotations(annotations map[string]string) {
	delete(annotations, openlitManagedAnnotation)
	delete(annotations, openlitManagedProfileAnnotation)
	delete(annotations, openlitManagedConfigHash)
	delete(annotations, openlitManagedSDKVersion)
	delete(annotations, "openlit.io/sdk-runtime")
}

func sdkConfigHash(svc *openlit.ServiceState, payload openlit.SDKActionPayload, runtime string) string {
	data, err := json.Marshal(map[string]any{
		"service": svc.ID,
		"runtime": runtime,
		"payload": payload,
	})
	if err != nil {
		data = []byte(fmt.Sprintf("%s|%s|%+v", svc.ID, runtime, payload))
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:8])
}
