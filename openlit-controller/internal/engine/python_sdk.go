package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
	"go.uber.org/zap"
)

const (
	openlitInstrumentationVolume    = "openlit-instrumentation-packages"
	openlitInstrumentationMountPath = "/instrumentation-packages"
	openlitInstrumentationInitName  = "openlit-auto-instrumentation"
	openlitManagedLabel             = "openlit.io/python-sdk-managed"
	openlitManagedVolumeLabel       = "openlit.io/python-sdk-volume"
	openlitManagedAnnotation        = "openlit.io/python-sdk-managed"
	openlitManagedConfigHash        = "openlit.io/python-sdk-config-hash"
	openlitManagedProfileAnnotation = "openlit.io/python-sdk-profile"
	openlitManagedSDKVersion        = "openlit.io/python-sdk-version"
	controllerManagedObservability  = "controller_managed"
	controllerManagedAgentMode      = "agent_observability"
	defaultDuplicatePolicy          = "block_if_existing_otel_detected"
)

type pythonSDKDecision string

const (
	pythonSDKDecisionApply pythonSDKDecision = "apply_controller_managed_sdk"
	pythonSDKDecisionAdopt pythonSDKDecision = "adopt_existing_openlit"
	pythonSDKDecisionBlock pythonSDKDecision = "block_existing_otel"
)

type pythonSDKPreflightResult struct {
	Decision pythonSDKDecision
	Source   string
	Conflict string
	Reason   string
}

var controllerManagedDisabledInstrumentors = []string{
	"openai",
	"anthropic",
	"cohere",
	"mistral",
	"groq",
	"google-ai-studio",
	"azure-ai-inference",
	"bedrock",
	"vertexai",
	"together",
	"fireworks",
	"deepseek",
	"ollama",
	"litellm",
	"httpx",
	"requests",
	"urllib",
	"urllib3",
	"aiohttp-client",
}

func (e *Engine) EnablePythonSDK(serviceID string, payload openlit.PythonSDKActionPayload) error {
	if payload.TargetRuntime == "" {
		payload.TargetRuntime = "python"
	}
	if payload.InstrumentationProfile == "" {
		payload.InstrumentationProfile = controllerManagedObservability
	}
	if payload.ObservabilityScope == "" {
		payload.ObservabilityScope = "agent"
	}
	if payload.DuplicatePolicy == "" {
		payload.DuplicatePolicy = defaultDuplicatePolicy
	}
	if payload.OTLPEndpoint == "" {
		payload.OTLPEndpoint = e.otlpEndpoint
	}
	if payload.SDKVersion == "" {
		payload.SDKVersion = e.sdkVersion
	}

	svc, err := e.serviceSnapshot(serviceID)
	if err != nil {
		return err
	}

	if strings.ToLower(svc.LanguageRuntime) != "python" {
		e.setAgentObservabilityState(
			serviceID,
			"unsupported",
			"none",
			"",
			"Controller-managed Python SDK injection is only available for Python services",
		)
		return fmt.Errorf("service %q is not a Python runtime", svc.ServiceName)
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
		if err := e.enablePythonSDKKubernetes(svc, payload); err != nil {
			return err
		}
		e.setDesiredAgentObservabilityState(
			serviceID,
			"enabled",
			"controller_managed",
			"",
			"Controller-managed Python SDK rollout configured for Kubernetes workload",
		)
		e.setSDKVersionAttr(serviceID, sdkVersionLabel)
		return nil
	case config.DeployDocker:
		if err := e.enablePythonSDKDocker(svc, payload); err != nil {
			return err
		}
		e.setDesiredAgentObservabilityState(
			serviceID,
			"enabled",
			"controller_managed",
			"",
			"Controller-managed Python SDK rollout configured for Docker container",
		)
		e.setSDKVersionAttr(serviceID, sdkVersionLabel)
		return nil
	default:
		isContainerized := svc.ResourceAttributes["openlit.is_containerized"] == "true"
		containerID := svc.ResourceAttributes["container.id"]

		if isContainerized && containerID != "" {
			if e.container != nil && e.container.dockerClient != nil && e.container.dockerClient.canManage() {
				if err := e.enablePythonSDKDocker(svc, payload); err != nil {
					return err
				}
				e.setDesiredAgentObservabilityState(
					serviceID,
					"enabled",
					"controller_managed",
					"",
					"Controller-managed Python SDK rollout configured for Docker container (detected from Linux host)",
				)
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
			if err := e.enablePythonSDKLinux(svc, payload); err != nil {
				return err
			}
			e.setDesiredAgentObservabilityState(
				serviceID,
				"enabled",
				"controller_managed",
				"",
				"Controller-managed Python SDK rollout configured for systemd service",
			)
			e.setSDKVersionAttr(serviceID, sdkVersionLabel)
			return nil
		}

		if err := e.enablePythonSDKBareProcess(svc, payload); err != nil {
			return err
		}
		e.setSDKVersionAttr(serviceID, sdkVersionLabel)
		return nil
	}
}

func (e *Engine) DisablePythonSDK(serviceID string, _ openlit.PythonSDKActionPayload) error {
	svc, err := e.serviceSnapshot(serviceID)
	if err != nil {
		return err
	}

	if strings.ToLower(svc.LanguageRuntime) != "python" {
		e.setAgentObservabilityState(
			serviceID,
			"unsupported",
			"none",
			"",
			"Controller-managed Python SDK injection is only available for Python services",
		)
		return fmt.Errorf("service %q is not a Python runtime", svc.ServiceName)
	}

	switch e.deployMode {
	case config.DeployKubernetes:
		if err := e.disablePythonSDKKubernetes(svc); err != nil {
			return err
		}
		e.setDesiredAgentObservabilityState(
			serviceID,
			"disabled",
			"none",
			"",
			"Controller-managed Python SDK removed from Kubernetes workload",
		)
		return nil
	case config.DeployDocker:
		if err := e.disablePythonSDKDocker(svc); err != nil {
			return err
		}
		e.setDesiredAgentObservabilityState(
			serviceID,
			"disabled",
			"none",
			"",
			"Controller-managed Python SDK removed from Docker container",
		)
		return nil
	default:
		isContainerized := svc.ResourceAttributes["openlit.is_containerized"] == "true"
		containerID := svc.ResourceAttributes["container.id"]

		if isContainerized && containerID != "" {
			if e.container != nil && e.container.dockerClient != nil && e.container.dockerClient.canManage() {
				if err := e.disablePythonSDKDocker(svc); err != nil {
					return err
				}
				e.setDesiredAgentObservabilityState(
					serviceID,
					"disabled",
					"none",
					"",
					"Controller-managed Python SDK removed from Docker container (detected from Linux host)",
				)
				return nil
			}
			return fmt.Errorf("containerized process detected but Docker socket not available to disable Agent O11y")
		}

		if svc.ResourceAttributes["systemd.unit"] != "" {
			if err := e.disablePythonSDKLinux(svc); err != nil {
				return err
			}
			e.setDesiredAgentObservabilityState(
				serviceID,
				"disabled",
				"none",
				"",
				"Controller-managed Python SDK removed from systemd service",
			)
			return nil
		}

		e.setDesiredAgentObservabilityState(
			serviceID,
			"disabled",
			"none",
			"",
			"Agent O11y disabled. Remove PYTHONPATH environment variable and restart the process.",
		)
		return nil
	}
}

func (e *Engine) serviceSnapshot(serviceID string) (*openlit.ServiceState, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	svc, ok := e.services[serviceID]
	if !ok {
		return nil, fmt.Errorf("service %q not found", serviceID)
	}

	copyAttrs := make(map[string]string, len(svc.ResourceAttributes))
	for key, value := range svc.ResourceAttributes {
		copyAttrs[key] = value
	}

	copied := *svc
	copied.ResourceAttributes = copyAttrs
	return &copied, nil
}

func (e *Engine) setAgentObservabilityState(
	serviceID, status, source, conflict, reason string,
) {
	e.mu.Lock()
	defer e.mu.Unlock()

	svc, ok := e.services[serviceID]
	if !ok {
		return
	}

	e.applyAgentStateLocked(svc, status, source, conflict, reason)
}

func (e *Engine) setDesiredAgentObservabilityState(
	serviceID, status, source, conflict, reason string,
) {
	e.mu.Lock()
	defer e.mu.Unlock()

	svc, ok := e.services[serviceID]
	if !ok {
		return
	}
	svc.DesiredAgentObservabilityStatus = status
	svc.DesiredAgentObservabilityReason = reason
	e.applyAgentStateLocked(svc, status, source, conflict, reason)
}

func (e *Engine) setSDKVersionAttr(serviceID, version string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	svc, ok := e.services[serviceID]
	if !ok {
		return
	}
	if svc.ResourceAttributes == nil {
		svc.ResourceAttributes = make(map[string]string)
	}
	svc.ResourceAttributes["openlit.sdk.version"] = version
}

func (e *Engine) applyAgentStateLocked(
	svc *openlit.ServiceState,
	status, source, conflict, reason string,
) {
	svc.AgentObservabilityStatus = status
	svc.AgentObservabilitySource = source
	svc.ObservabilityConflict = conflict
	svc.ObservabilityReason = reason
	if svc.ResourceAttributes == nil {
		svc.ResourceAttributes = make(map[string]string)
	}

	if status != "" {
		svc.ResourceAttributes["openlit.agent_observability.status"] = status
	}
	if source != "" {
		svc.ResourceAttributes["openlit.agent_observability.source"] = source
	} else {
		delete(svc.ResourceAttributes, "openlit.agent_observability.source")
	}
	if conflict != "" {
		svc.ResourceAttributes["openlit.observability.conflict"] = conflict
	} else {
		delete(svc.ResourceAttributes, "openlit.observability.conflict")
	}
	if reason != "" {
		svc.ResourceAttributes["openlit.observability.reason"] = reason
	} else {
		delete(svc.ResourceAttributes, "openlit.observability.reason")
	}
	if svc.DesiredAgentObservabilityStatus != "" {
		svc.ResourceAttributes["openlit.agent_observability.desired_status"] = svc.DesiredAgentObservabilityStatus
	} else {
		delete(svc.ResourceAttributes, "openlit.agent_observability.desired_status")
	}
}

func (e *Engine) enablePythonSDKKubernetes(
	svc *openlit.ServiceState,
	payload openlit.PythonSDKActionPayload,
) error {
	if e.container == nil || e.container.k8sClient == nil {
		return fmt.Errorf("kubernetes client unavailable for Python SDK injection")
	}

	namespace := svc.ResourceAttributes["k8s.namespace.name"]
	workloadKind := svc.ResourceAttributes["k8s.workload.kind"]
	workloadName := svc.DeploymentName
	containerName := svc.ResourceAttributes["container.name"]

	if workloadKind == "" || workloadKind == "Pod" {
		return e.enablePythonSDKNakedPod(svc, payload)
	}

	if namespace == "" || workloadName == "" {
		return fmt.Errorf("missing Kubernetes workload metadata for %s", svc.ServiceName)
	}

	workload, err := e.container.k8sClient.getWorkload(namespace, workloadKind, workloadName)
	if err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to fetch workload %s/%s: %v", workloadKind, workloadName, err))
		return fmt.Errorf("fetching workload %s/%s: %w", workloadKind, workloadName, err)
	}

	container, err := findTargetContainer(workload, containerName)
	if err != nil {
		return err
	}

	preflight := evaluatePythonSDKPreflight(
		extractContainerEnv(container),
		flattenContainerCommand(container),
		payload.DuplicatePolicy,
	)
	if preflight.Decision == pythonSDKDecisionBlock {
		e.setAgentObservabilityState(svc.ID, "conflict", preflight.Source, preflight.Conflict, preflight.Reason)
		return fmt.Errorf("%s", preflight.Reason)
	}
	if preflight.Decision == pythonSDKDecisionAdopt {
		e.setAgentObservabilityState(svc.ID, "enabled", preflight.Source, "", preflight.Reason)
		return nil
	}

	patch, err := buildPythonSDKWorkloadPatch(workload, containerName, svc, payload, true)
	if err != nil {
		return err
	}
	if err := e.container.k8sClient.patchWorkload(namespace, workloadKind, workloadName, patch); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to patch workload %s/%s: %v", workloadKind, workloadName, err))
		return err
	}
	return nil
}

func (e *Engine) disablePythonSDKKubernetes(svc *openlit.ServiceState) error {
	if e.container == nil || e.container.k8sClient == nil {
		return fmt.Errorf("kubernetes client unavailable for Python SDK removal")
	}

	namespace := svc.ResourceAttributes["k8s.namespace.name"]
	workloadKind := svc.ResourceAttributes["k8s.workload.kind"]
	workloadName := svc.DeploymentName
	containerName := svc.ResourceAttributes["container.name"]

	if workloadKind == "" || workloadKind == "Pod" {
		return e.disablePythonSDKNakedPod(svc)
	}

	if namespace == "" || workloadName == "" {
		return fmt.Errorf("missing Kubernetes workload metadata for %s", svc.ServiceName)
	}

	workload, err := e.container.k8sClient.getWorkload(namespace, workloadKind, workloadName)
	if err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to fetch workload %s/%s: %v", workloadKind, workloadName, err))
		return fmt.Errorf("fetching workload %s/%s: %w", workloadKind, workloadName, err)
	}

	patch, err := buildPythonSDKWorkloadPatch(workload, containerName, svc, openlit.PythonSDKActionPayload{}, false)
	if err != nil {
		return err
	}
	if err := e.container.k8sClient.patchWorkload(namespace, workloadKind, workloadName, patch); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to patch workload %s/%s: %v", workloadKind, workloadName, err))
		return err
	}
	return nil
}

func (e *Engine) enablePythonSDKNakedPod(svc *openlit.ServiceState, payload openlit.PythonSDKActionPayload) error {
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

	preflight := evaluatePythonSDKPreflight(
		extractContainerEnv(containers[targetIndex]),
		flattenContainerCommand(containers[targetIndex]),
		payload.DuplicatePolicy,
	)
	if preflight.Decision == pythonSDKDecisionBlock {
		e.setAgentObservabilityState(svc.ID, "conflict", preflight.Source, preflight.Conflict, preflight.Reason)
		return fmt.Errorf("%s", preflight.Reason)
	}
	if preflight.Decision == pythonSDKDecisionAdopt {
		e.setAgentObservabilityState(svc.ID, "enabled", preflight.Source, "", preflight.Reason)
		return nil
	}

	appImage := resolveContainerImage(containers, containerName)
	if appImage == "" {
		return fmt.Errorf("cannot resolve image for naked pod container %q", containerName)
	}

	installCmd := buildPyPIInstallShellCmd(openlitInstrumentationMountPath, payload.SDKVersion)

	if err := applyPythonSDKContainerSettings(containers[targetIndex], svc, payload); err != nil {
		return err
	}

	nakedInitContainer := map[string]any{
		"name":    openlitInstrumentationInitName,
		"image":   appImage,
		"command": []any{"sh", "-c", installCmd},
		"volumeMounts": []any{
			map[string]any{
				"name":      openlitInstrumentationVolume,
				"mountPath": openlitInstrumentationMountPath,
			},
		},
	}
	if policy := resolveContainerImagePullPolicy(containers, containerName); policy != "" {
		nakedInitContainer["imagePullPolicy"] = policy
	}

	spec["initContainers"] = objectSliceToAny(
		upsertNamedObject(
			extractObjectSlice(spec["initContainers"]),
			openlitInstrumentationInitName,
			nakedInitContainer,
		),
	)
	spec["volumes"] = objectSliceToAny(
		upsertNamedObject(
			extractObjectSlice(spec["volumes"]),
			openlitInstrumentationVolume,
			map[string]any{
				"name":     openlitInstrumentationVolume,
				"emptyDir": map[string]any{},
			},
		),
	)
	spec["containers"] = objectSliceToAny(containers)

	metadata, _ := pod["metadata"].(map[string]any)
	annotations := copyStringMap(metadata["annotations"])
	annotations[openlitManagedAnnotation] = "true"
	annotations[openlitManagedProfileAnnotation] = controllerManagedObservability
	annotations[openlitManagedConfigHash] = pythonSDKConfigHash(svc, payload)
	versionLabel := payload.SDKVersion
	if versionLabel == "" {
		versionLabel = "latest"
	}
	annotations[openlitManagedSDKVersion] = versionLabel

	stripPodRuntimeFields(pod)

	if metaMap, ok := pod["metadata"].(map[string]any); ok {
		if annotations != nil {
			metaMap["annotations"] = stringMapToAny(annotations)
		}
	}

	originalPodJSON, _ := json.Marshal(pod)

	if err := e.container.k8sClient.deletePod(namespace, podName, 0); err != nil {
		return fmt.Errorf("deleting naked pod %s/%s for SDK injection: %w", namespace, podName, err)
	}

	if err := e.container.k8sClient.createPod(namespace, pod); err != nil {
		e.logger.Error("naked pod create failed after delete, attempting rollback with original spec",
			zap.String("namespace", namespace),
			zap.String("pod", podName),
			zap.Error(err),
		)
		var originalPod map[string]any
		if unmarshalErr := json.Unmarshal(originalPodJSON, &originalPod); unmarshalErr == nil {
			stripPodRuntimeFields(originalPod)
			if restoreErr := e.container.k8sClient.createPod(namespace, originalPod); restoreErr != nil {
				e.logger.Error("CRITICAL: naked pod rollback failed — pod is deleted and could not be restored. Manual intervention required.",
					zap.String("namespace", namespace),
					zap.String("pod", podName),
					zap.Error(restoreErr),
				)
				e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "",
					fmt.Sprintf("CRITICAL: Pod %s/%s was deleted but could not be recreated. Manual intervention required.", namespace, podName))
			}
		}
		return fmt.Errorf("recreating naked pod %s/%s with SDK: %w", namespace, podName, err)
	}

	return nil
}

func (e *Engine) disablePythonSDKNakedPod(svc *openlit.ServiceState) error {
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

	removePythonSDKContainerSettings(containers[targetIndex])
	spec["initContainers"] = objectSliceToAny(
		removeNamedObject(
			extractObjectSlice(spec["initContainers"]),
			openlitInstrumentationInitName,
		),
	)
	spec["volumes"] = objectSliceToAny(
		removeNamedObject(
			extractObjectSlice(spec["volumes"]),
			openlitInstrumentationVolume,
		),
	)
	spec["containers"] = objectSliceToAny(containers)

	metadata, _ := pod["metadata"].(map[string]any)
	annotations := copyStringMap(metadata["annotations"])
	delete(annotations, openlitManagedAnnotation)
	delete(annotations, openlitManagedProfileAnnotation)
	delete(annotations, openlitManagedConfigHash)

	stripPodRuntimeFields(pod)

	if metaMap, ok := pod["metadata"].(map[string]any); ok {
		if annotations != nil {
			metaMap["annotations"] = stringMapToAny(annotations)
		}
	}

	originalPodJSON, _ := json.Marshal(pod)

	if err := e.container.k8sClient.deletePod(namespace, podName, 0); err != nil {
		return fmt.Errorf("deleting naked pod %s/%s for SDK removal: %w", namespace, podName, err)
	}

	if err := e.container.k8sClient.createPod(namespace, pod); err != nil {
		e.logger.Error("naked pod create failed after delete during disable, attempting rollback",
			zap.String("namespace", namespace),
			zap.String("pod", podName),
			zap.Error(err),
		)
		var originalPod map[string]any
		if unmarshalErr := json.Unmarshal(originalPodJSON, &originalPod); unmarshalErr == nil {
			stripPodRuntimeFields(originalPod)
			if restoreErr := e.container.k8sClient.createPod(namespace, originalPod); restoreErr != nil {
				e.logger.Error("CRITICAL: naked pod rollback failed — pod is deleted and could not be restored. Manual intervention required.",
					zap.String("namespace", namespace),
					zap.String("pod", podName),
					zap.Error(restoreErr),
				)
				e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "",
					fmt.Sprintf("CRITICAL: Pod %s/%s was deleted but could not be recreated. Manual intervention required.", namespace, podName))
			}
		}
		return fmt.Errorf("recreating naked pod %s/%s without SDK: %w", namespace, podName, err)
	}

	return nil
}

func stripPodRuntimeFields(pod map[string]any) {
	delete(pod, "status")
	if metadata, ok := pod["metadata"].(map[string]any); ok {
		delete(metadata, "uid")
		delete(metadata, "resourceVersion")
		delete(metadata, "creationTimestamp")
		delete(metadata, "selfLink")
		delete(metadata, "managedFields")
	}
	if spec, ok := pod["spec"].(map[string]any); ok {
		delete(spec, "nodeName")
	}
}

func stringMapToAny(m map[string]string) map[string]any {
	result := make(map[string]any, len(m))
	for k, v := range m {
		result[k] = v
	}
	return result
}

func evaluatePythonSDKPreflight(
	env map[string]string,
	command []string,
	duplicatePolicy string,
) pythonSDKPreflightResult {
	lowerCommand := strings.ToLower(strings.Join(command, " "))

	isControllerManaged := strings.EqualFold(env["OPENLIT_CONTROLLER_MODE"], controllerManagedAgentMode)
	if strings.Contains(strings.ToLower(env["PYTHONPATH"]), openlitInstrumentationMountPath) {
		isControllerManaged = true
	}
	if isControllerManaged {
		return pythonSDKPreflightResult{
			Decision: pythonSDKDecisionAdopt,
			Source:   "controller_managed",
			Reason:   "Existing controller-managed OpenLIT Python SDK configuration detected",
		}
	}

	hasExistingOpenLIT :=
		env["OPENLIT_DISABLED_INSTRUMENTORS"] != "" ||
			env["OPENLIT_DISABLE_METRICS"] != "" ||
			env["OPENLIT_DISABLE_EVENTS"] != "" ||
			strings.Contains(lowerCommand, "openlit")
	if hasExistingOpenLIT {
		return pythonSDKPreflightResult{
			Decision: pythonSDKDecisionAdopt,
			Source:   "existing_openlit",
			Reason:   "Existing OpenLIT Python SDK configuration detected and adopted",
		}
	}

	hasExistingOTel :=
		env["OTEL_PYTHON_DISTRO"] != "" ||
			env["OTEL_PYTHON_CONFIGURATOR"] != "" ||
			hasAnyEnvWithPrefix(env, "OTEL_EXPORTER_") ||
			strings.Contains(lowerCommand, "opentelemetry-instrument")
	if hasExistingOTel && duplicatePolicy == "block_if_existing_otel_detected" {
		return pythonSDKPreflightResult{
			Decision: pythonSDKDecisionBlock,
			Source:   "existing_otel",
			Conflict: "existing_otel",
			Reason:   "Existing OpenTelemetry Python instrumentation detected on target workload",
		}
	}

	return pythonSDKPreflightResult{
		Decision: pythonSDKDecisionApply,
		Source:   "controller_managed",
		Reason:   "Controller-managed OpenLIT Python SDK will be applied",
	}
}

func flattenContainerCommand(container map[string]any) []string {
	command := make([]string, 0)
	command = append(command, extractStringSlice(container["command"])...)
	command = append(command, extractStringSlice(container["args"])...)
	return command
}

func resolveContainerImage(containers []map[string]any, containerName string) string {
	idx, err := selectContainerIndex(containers, containerName)
	if err != nil {
		return ""
	}
	image, _ := containers[idx]["image"].(string)
	return image
}

func resolveContainerImagePullPolicy(containers []map[string]any, containerName string) string {
	idx, err := selectContainerIndex(containers, containerName)
	if err != nil {
		return ""
	}
	policy, _ := containers[idx]["imagePullPolicy"].(string)
	return policy
}

func buildPythonSDKWorkloadPatch(
	workload map[string]any,
	containerName string,
	svc *openlit.ServiceState,
	payload openlit.PythonSDKActionPayload,
	enable bool,
) (map[string]any, error) {
	template, err := getTemplate(workload)
	if err != nil {
		return nil, err
	}
	templateMeta := ensureMap(template, "metadata")
	templateSpec := ensureMap(template, "spec")

	annotations := copyStringMap(templateMeta["annotations"])
	if enable {
		annotations[openlitManagedAnnotation] = "true"
		annotations[openlitManagedProfileAnnotation] = controllerManagedObservability
		annotations[openlitManagedConfigHash] = pythonSDKConfigHash(svc, payload)
		versionLabel := payload.SDKVersion
		if versionLabel == "" {
			versionLabel = "latest"
		}
		annotations[openlitManagedSDKVersion] = versionLabel
	} else {
		delete(annotations, openlitManagedAnnotation)
		delete(annotations, openlitManagedProfileAnnotation)
		delete(annotations, openlitManagedConfigHash)
		delete(annotations, openlitManagedSDKVersion)
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

		installCmd := buildPyPIInstallShellCmd(openlitInstrumentationMountPath, payload.SDKVersion)

		if err := applyPythonSDKContainerSettings(containers[targetIndex], svc, payload); err != nil {
			return nil, err
		}

		initContainer := map[string]any{
			"name":    openlitInstrumentationInitName,
			"image":   appImage,
			"command": []any{"sh", "-c", installCmd},
			"volumeMounts": []any{
				map[string]any{
					"name":      openlitInstrumentationVolume,
					"mountPath": openlitInstrumentationMountPath,
				},
			},
		}
		if policy := resolveContainerImagePullPolicy(containers, containerName); policy != "" {
			initContainer["imagePullPolicy"] = policy
		}

		templateSpec["initContainers"] = objectSliceToAny(
			upsertNamedObject(
				extractObjectSlice(templateSpec["initContainers"]),
				openlitInstrumentationInitName,
				initContainer,
			),
		)
		templateSpec["volumes"] = objectSliceToAny(
			upsertNamedObject(
				extractObjectSlice(templateSpec["volumes"]),
				openlitInstrumentationVolume,
				map[string]any{
					"name":     openlitInstrumentationVolume,
					"emptyDir": map[string]any{},
				},
			),
		)
	} else {
		removePythonSDKContainerSettings(containers[targetIndex])
		templateSpec["initContainers"] = objectSliceToAny(
			removeNamedObject(
				extractObjectSlice(templateSpec["initContainers"]),
				openlitInstrumentationInitName,
			),
		)
		templateSpec["volumes"] = objectSliceToAny(
			removeNamedObject(
				extractObjectSlice(templateSpec["volumes"]),
				openlitInstrumentationVolume,
			),
		)
	}

	templateSpec["containers"] = objectSliceToAny(containers)

	return map[string]any{
		"spec": map[string]any{
			"template": map[string]any{
				"metadata": map[string]any{
					"annotations": annotations,
				},
				"spec": templateSpec,
			},
		},
	}, nil
}

func k8sManagedPythonPath() string {
	return fmt.Sprintf("%s/%s:%s/%s",
		openlitInstrumentationMountPath, pythonSDKBootstrapDirName,
		openlitInstrumentationMountPath, pythonSDKPackagesDirName,
	)
}

func applyPythonSDKContainerSettings(
	container map[string]any,
	svc *openlit.ServiceState,
	payload openlit.PythonSDKActionPayload,
) error {
	env := extractObjectSlice(container["env"])
	pyPath, err := prependEnvValue(env, "PYTHONPATH", k8sManagedPythonPath())
	if err != nil {
		return err
	}
	env = pyPath
	env = upsertEnvValue(env, "OPENLIT_CONTROLLER_MODE", controllerManagedAgentMode)
	env = upsertEnvValue(env, "OTEL_SERVICE_NAME", svc.ServiceName)
	env = upsertEnvValue(env, "OTEL_EXPORTER_OTLP_ENDPOINT", payload.OTLPEndpoint)
	env = upsertEnvValue(
		env,
		"OPENLIT_DISABLED_INSTRUMENTORS",
		strings.Join(controllerManagedDisabledInstrumentors, ","),
	)
	container["env"] = objectSliceToAny(env)

	volumeMounts := extractObjectSlice(container["volumeMounts"])
	volumeMounts = upsertNamedObject(
		volumeMounts,
		openlitInstrumentationVolume,
		map[string]any{
			"name":      openlitInstrumentationVolume,
			"mountPath": openlitInstrumentationMountPath,
		},
	)
	container["volumeMounts"] = objectSliceToAny(volumeMounts)
	return nil
}

func removePythonSDKContainerSettings(container map[string]any) {
	env := extractObjectSlice(container["env"])
	for _, key := range []string{
		"OPENLIT_CONTROLLER_MODE",
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OPENLIT_DISABLED_INSTRUMENTORS",
	} {
		env = removeEnvValue(env, key)
	}
	env = removePrefixedEnvValue(env, "PYTHONPATH", k8sManagedPythonPath())
	env = removePrefixedEnvValue(env, "PYTHONPATH", openlitInstrumentationMountPath)
	container["env"] = objectSliceToAny(env)

	volumeMounts := removeNamedObject(
		extractObjectSlice(container["volumeMounts"]),
		openlitInstrumentationVolume,
	)
	container["volumeMounts"] = objectSliceToAny(volumeMounts)
}

func pythonSDKConfigHash(svc *openlit.ServiceState, payload openlit.PythonSDKActionPayload) string {
	data, _ := json.Marshal(map[string]any{
		"service": svc.ID,
		"payload": payload,
	})
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:8])
}

func getTemplate(workload map[string]any) (map[string]any, error) {
	spec, ok := workload["spec"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("workload spec missing")
	}
	template, ok := spec["template"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("workload template missing")
	}
	return template, nil
}

func ensureMap(parent map[string]any, key string) map[string]any {
	if existing, ok := parent[key].(map[string]any); ok {
		return existing
	}
	next := make(map[string]any)
	parent[key] = next
	return next
}

func extractContainers(value any) ([]map[string]any, error) {
	containers := extractObjectSlice(value)
	if len(containers) == 0 {
		return nil, fmt.Errorf("workload has no containers")
	}
	return containers, nil
}

func findTargetContainer(workload map[string]any, containerName string) (map[string]any, error) {
	template, err := getTemplate(workload)
	if err != nil {
		return nil, err
	}
	containers, err := extractContainers(ensureMap(template, "spec")["containers"])
	if err != nil {
		return nil, err
	}
	index, err := selectContainerIndex(containers, containerName)
	if err != nil {
		return nil, err
	}
	return containers[index], nil
}

func selectContainerIndex(containers []map[string]any, containerName string) (int, error) {
	if containerName == "" && len(containers) == 1 {
		return 0, nil
	}
	for index, container := range containers {
		if container["name"] == containerName {
			return index, nil
		}
	}
	if len(containers) == 1 {
		return 0, nil
	}
	return -1, fmt.Errorf("failed to resolve target container %q", containerName)
}

func extractObjectSlice(value any) []map[string]any {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if object, ok := item.(map[string]any); ok {
			result = append(result, object)
		}
	}
	return result
}

func objectSliceToAny(items []map[string]any) []any {
	result := make([]any, 0, len(items))
	for _, item := range items {
		result = append(result, item)
	}
	return result
}

func upsertNamedObject(items []map[string]any, name string, next map[string]any) []map[string]any {
	for index, item := range items {
		if item["name"] == name {
			items[index] = next
			return items
		}
	}
	return append(items, next)
}

func removeNamedObject(items []map[string]any, name string) []map[string]any {
	filtered := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if item["name"] == name {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func extractContainerEnv(container map[string]any) map[string]string {
	env := make(map[string]string)
	for _, item := range extractObjectSlice(container["env"]) {
		name, _ := item["name"].(string)
		value, _ := item["value"].(string)
		if name != "" {
			env[name] = value
		}
	}
	return env
}

func upsertEnvValue(env []map[string]any, key, value string) []map[string]any {
	for index, item := range env {
		if item["name"] == key {
			env[index]["value"] = value
			delete(env[index], "valueFrom")
			return env
		}
	}
	return append(env, map[string]any{"name": key, "value": value})
}

func removeEnvValue(env []map[string]any, key string) []map[string]any {
	filtered := make([]map[string]any, 0, len(env))
	for _, item := range env {
		if item["name"] == key {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func prependEnvValue(env []map[string]any, key, prefix string) ([]map[string]any, error) {
	for index, item := range env {
		if item["name"] != key {
			continue
		}
		if _, hasValueFrom := item["valueFrom"]; hasValueFrom {
			return nil, fmt.Errorf("%s uses valueFrom and cannot be safely rewritten", key)
		}
		existing, _ := item["value"].(string)
		if existing == "" {
			env[index]["value"] = prefix
			return env, nil
		}
		if strings.Contains(existing, prefix) {
			return env, nil
		}
		env[index]["value"] = fmt.Sprintf("%s:%s", prefix, existing)
		return env, nil
	}
	return append(env, map[string]any{"name": key, "value": prefix}), nil
}

func removePrefixedEnvValue(env []map[string]any, key, prefix string) []map[string]any {
	for index, item := range env {
		if item["name"] != key {
			continue
		}
		value, _ := item["value"].(string)
		value = strings.TrimPrefix(value, prefix+":")
		value = strings.TrimPrefix(value, prefix)
		if value == "" {
			return removeEnvValue(env, key)
		}
		env[index]["value"] = value
		return env
	}
	return env
}

func copyStringMap(value any) map[string]string {
	result := make(map[string]string)
	source, ok := value.(map[string]any)
	if !ok {
		return result
	}
	for key, item := range source {
		if str, ok := item.(string); ok {
			result[key] = str
		}
	}
	return result
}

func extractStringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if str, ok := item.(string); ok {
			result = append(result, str)
		}
	}
	return result
}
