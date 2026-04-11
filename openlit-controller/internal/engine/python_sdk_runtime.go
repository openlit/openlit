package engine

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/openlit/openlit/openlit-controller/internal/openlit"
	"go.uber.org/zap"
)

func (e *Engine) enablePythonSDKDocker(
	svc *openlit.ServiceState,
	payload openlit.PythonSDKActionPayload,
) error {
	if e.container == nil || e.container.dockerClient == nil || !e.container.dockerClient.canManage() {
		e.setAgentObservabilityState(
			svc.ID,
			"unsupported",
			"none",
			"",
			"Docker Agent Observability requires a writable Docker socket and a Docker-capable controller",
		)
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

	preflight := evaluatePythonSDKPreflight(
		dockerInspectEnv(inspect),
		dockerInspectCommand(inspect),
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

	nextHash := pythonSDKConfigHash(svc, payload)
	e.logger.Info("starting docker agent observability rollout",
		zap.String("mode", "docker"),
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("previous_hash", dockerInspectManagedConfigHash(inspect)),
		zap.String("next_hash", nextHash),
	)

	if err := ensureDockerContainerManageable(inspect); err != nil {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", err.Error())
		return err
	}

	volumeName := dockerSDKVolumeName(svc)
	if err := e.prepareDockerSDKVolume(inspect, svc, volumeName, payload.SDKVersion); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", err.Error())
		return err
	}

	payloadMap, err := buildDockerContainerCreatePayload(inspect, svc, payload, volumeName, true)
	if err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", fmt.Sprintf("Failed to build container config: %v", err))
		return err
	}

	if err := e.recreateDockerContainer(inspect, payloadMap); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", err.Error())
		return err
	}
	e.logger.Info("completed docker agent observability rollout",
		zap.String("mode", "docker"),
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("previous_hash", dockerInspectManagedConfigHash(inspect)),
		zap.String("next_hash", nextHash),
	)
	return nil
}

func (e *Engine) disablePythonSDKDocker(svc *openlit.ServiceState) error {
	if e.container == nil || e.container.dockerClient == nil || !e.container.dockerClient.canManage() {
		e.setAgentObservabilityState(
			svc.ID,
			"unsupported",
			"none",
			"",
			"Docker Agent Observability requires a writable Docker socket and a Docker-capable controller",
		)
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

	previousHash := dockerInspectManagedConfigHash(inspect)
	e.logger.Info("starting docker agent observability removal",
		zap.String("mode", "docker"),
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("previous_hash", previousHash),
		zap.String("next_hash", ""),
	)

	volumeName := dockerSDKVolumeName(svc)
	payloadMap, err := buildDockerContainerCreatePayload(inspect, svc, openlit.PythonSDKActionPayload{}, volumeName, false)
	if err != nil {
		return err
	}

	if err := e.recreateDockerContainer(inspect, payloadMap); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", err.Error())
		return err
	}
	_ = e.container.dockerClient.removeVolume(volumeName)
	e.logger.Info("completed docker agent observability removal",
		zap.String("mode", "docker"),
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("previous_hash", previousHash),
		zap.String("next_hash", ""),
	)
	return nil
}

func (e *Engine) prepareDockerSDKVolume(
	inspect map[string]any,
	svc *openlit.ServiceState,
	volumeName string,
	sdkVersion string,
) error {
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

	installCmd := buildPyPIInstallShellCmd(openlitInstrumentationMountPath, sdkVersion)

	helperPayload := map[string]any{
		"Image":      image,
		"Entrypoint": []any{"sh"},
		"Cmd":        []any{"-c", installCmd},
		"HostConfig": map[string]any{
			"Binds":       []any{fmt.Sprintf("%s:%s", volumeName, openlitInstrumentationMountPath)},
			"NetworkMode": dockerInspectHostConfigValue(inspect, "NetworkMode"),
		},
	}

	helperName := "openlit-python-sdk-installer-" + shortHash(svc.WorkloadKey+time.Now().String())
	helperID, err := e.container.dockerClient.createContainer(helperName, helperPayload)
	if err != nil {
		return err
	}
	defer e.container.dockerClient.removeContainer(helperID, true)

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

func (e *Engine) recreateDockerContainer(inspect map[string]any, payload map[string]any) error {
	containerID, _ := inspect["Id"].(string)
	originalName := strings.TrimPrefix(dockerInspectName(inspect), "/")
	if containerID == "" || originalName == "" {
		return fmt.Errorf("docker container identity missing for recreate")
	}

	backupName := originalName + "-openlit-backup-" + shortHash(containerID+time.Now().String())
	if err := e.container.dockerClient.stopContainer(containerID, 10); err != nil {
		return err
	}
	if err := e.container.dockerClient.renameContainer(containerID, backupName); err != nil {
		if startErr := e.container.dockerClient.startContainer(containerID); startErr != nil {
			e.logger.Error("CRITICAL: container stopped and rename failed; could not restart original",
				zap.String("container_id", containerID),
				zap.String("workload", originalName),
				zap.Error(startErr),
			)
		}
		return err
	}

	newID, createErr := e.container.dockerClient.createContainer(originalName, payload)
	if createErr != nil {
		e.logger.Error("docker rollback: create failed, restoring original",
			zap.String("workload", originalName),
			zap.Error(createErr),
		)
		if renameErr := e.container.dockerClient.renameContainer(containerID, originalName); renameErr != nil {
			e.logger.Error("docker rollback: rename-back failed",
				zap.String("container_id", containerID),
				zap.String("workload", originalName),
				zap.Error(renameErr),
			)
		}
		if startErr := e.container.dockerClient.startContainer(containerID); startErr != nil {
			e.logger.Error("CRITICAL: docker rollback failed — container is stopped and could not be restored. Manual intervention required.",
				zap.String("container_id", containerID),
				zap.String("workload", originalName),
				zap.Error(startErr),
			)
		}
		return createErr
	}

	if err := e.container.dockerClient.startContainer(newID); err != nil {
		e.logger.Error("docker rollback: start of new container failed, restoring original",
			zap.String("workload", originalName),
			zap.Error(err),
		)
		if removeErr := e.container.dockerClient.removeContainer(newID, true); removeErr != nil {
			e.logger.Error("docker rollback: remove new container failed",
				zap.String("new_container_id", newID),
				zap.String("workload", originalName),
				zap.Error(removeErr),
			)
		}
		if renameErr := e.container.dockerClient.renameContainer(containerID, originalName); renameErr != nil {
			e.logger.Error("docker rollback: rename-back failed",
				zap.String("container_id", containerID),
				zap.String("workload", originalName),
				zap.Error(renameErr),
			)
		}
		if startErr := e.container.dockerClient.startContainer(containerID); startErr != nil {
			e.logger.Error("CRITICAL: docker rollback failed — container is stopped and could not be restored. Manual intervention required.",
				zap.String("container_id", containerID),
				zap.String("workload", originalName),
				zap.Error(startErr),
			)
		}
		return err
	}

	if err := e.container.dockerClient.removeContainer(containerID, true); err != nil {
		e.logger.Warn("docker cleanup: failed to remove old container (new container is running)",
			zap.String("old_container_id", containerID),
			zap.String("workload", originalName),
			zap.Error(err),
		)
	}
	return nil
}

func buildDockerContainerCreatePayload(
	inspect map[string]any,
	svc *openlit.ServiceState,
	payload openlit.PythonSDKActionPayload,
	volumeName string,
	enable bool,
) (map[string]any, error) {
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
		envValues = upsertEnvString(envValues, "PYTHONPATH", dockerManagedPythonPath(envValues))
		envValues = upsertEnvString(envValues, "OPENLIT_CONTROLLER_MODE", controllerManagedAgentMode)
		envValues = upsertEnvString(envValues, "OTEL_SERVICE_NAME", svc.ServiceName)
		envValues = upsertEnvString(envValues, "OTEL_EXPORTER_OTLP_ENDPOINT", payload.OTLPEndpoint)
		envValues = upsertEnvString(
			envValues,
			"OPENLIT_DISABLED_INSTRUMENTORS",
			strings.Join(controllerManagedDisabledInstrumentors, ","),
		)
		labels := extractStringMap(createPayload["Labels"])
		labels[openlitManagedLabel] = "true"
		labels[openlitManagedVolumeLabel] = volumeName
		labels[openlitManagedConfigHash] = pythonSDKConfigHash(svc, payload)
		createPayload["Labels"] = labels
		hostConfig["Binds"] = upsertBindMount(extractStringList(hostConfig["Binds"]), fmt.Sprintf("%s:%s", volumeName, openlitInstrumentationMountPath), openlitInstrumentationMountPath)
	} else {
		envValues = removeEnvString(envValues, "OPENLIT_CONTROLLER_MODE")
		envValues = removeEnvString(envValues, "OTEL_EXPORTER_OTLP_ENDPOINT")
		envValues = removeEnvString(envValues, "OPENLIT_DISABLED_INSTRUMENTORS")
		envValues = rewritePythonPathWithoutManagedSDK(envValues)
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

func (e *Engine) enablePythonSDKLinux(
	svc *openlit.ServiceState,
	payload openlit.PythonSDKActionPayload,
) error {
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

	preflight := evaluatePythonSDKPreflight(
		readEnviron(e.procRoot, svc.PID),
		strings.Fields(svc.Cmdline),
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

	sdkRoot := filepath.Join(systemdSDKStateDir, sanitizeSystemdUnit(unit))
	nextHash := pythonSDKConfigHash(svc, payload)
	previousHash := readSystemdDropInConfigHash(unit)
	e.logger.Info("starting linux agent observability rollout",
		zap.String("mode", "linux"),
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("unit", unit),
		zap.String("previous_hash", previousHash),
		zap.String("next_hash", nextHash),
	)
	if err := installPythonSDKFromPyPI(svc.ExePath, sdkRoot, payload.SDKVersion); err != nil {
		e.setAgentObservabilityState(svc.ID, "error", "controller_managed", "", err.Error())
		return err
	}

	env := readEnviron(e.procRoot, svc.PID)
	dropIn := buildSystemdDropInContent(
		unit,
		sdkRoot,
		svc.ServiceName,
		payload.OTLPEndpoint,
		strings.Join(controllerManagedDisabledInstrumentors, ","),
		env["PYTHONPATH"],
		nextHash,
	)
	if err := writeSystemdDropIn(unit, dropIn); err != nil {
		return err
	}

	if err := runSystemctl("daemon-reload"); err != nil {
		_ = removeSystemdDropIn(unit)
		e.logger.Warn("linux agent observability rollback triggered",
			zap.String("unit", unit),
			zap.String("rollback_result", "dropin_removed_after_daemon_reload_failure"),
			zap.Error(err),
		)
		return err
	}
	if err := runSystemctl("try-restart", unit); err != nil {
		_ = removeSystemdDropIn(unit)
		_ = runSystemctl("daemon-reload")
		e.logger.Warn("linux agent observability rollback triggered",
			zap.String("unit", unit),
			zap.String("rollback_result", "dropin_removed_after_restart_failure"),
			zap.Error(err),
		)
		return err
	}
	e.logger.Info("completed linux agent observability rollout",
		zap.String("mode", "linux"),
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("unit", unit),
		zap.String("previous_hash", previousHash),
		zap.String("next_hash", nextHash),
	)
	return nil
}

func (e *Engine) disablePythonSDKLinux(svc *openlit.ServiceState) error {
	if !linuxSystemdSDKSupported() {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", "Linux Agent Observability requires systemd and root-level unit management access")
		return fmt.Errorf("linux controller does not have systemd management support")
	}

	unit := svc.ResourceAttributes["systemd.unit"]
	if unit == "" {
		e.setAgentObservabilityState(svc.ID, "unsupported", "none", "", "This Linux workload is not managed by systemd")
		return fmt.Errorf("linux workload %s is not systemd-managed", svc.ServiceName)
	}
	previousHash := readSystemdDropInConfigHash(unit)
	e.logger.Info("starting linux agent observability removal",
		zap.String("mode", "linux"),
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("unit", unit),
		zap.String("previous_hash", previousHash),
		zap.String("next_hash", ""),
	)
	if err := removeSystemdDropIn(unit); err != nil {
		return err
	}
	if err := runSystemctl("daemon-reload"); err != nil {
		return err
	}
	if err := runSystemctl("try-restart", unit); err != nil {
		return err
	}
	e.logger.Info("completed linux agent observability removal",
		zap.String("mode", "linux"),
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("unit", unit),
		zap.String("previous_hash", previousHash),
		zap.String("next_hash", ""),
	)
	return nil
}

func ensureDockerContainerManageable(inspect map[string]any) error {
	hostConfig := dockerInspectHostConfig(inspect)
	restartPolicy, _ := hostConfig["RestartPolicy"].(map[string]any)
	restartName, _ := restartPolicy["Name"].(string)
	labels := extractStringMap(dockerInspectConfig(inspect)["Labels"])

	if restartName != "" && restartName != "no" {
		return nil
	}
	if labels["com.docker.compose.project"] != "" && labels["com.docker.compose.service"] != "" {
		return nil
	}
	return fmt.Errorf("container is not controller-manageable: missing restart policy or compose metadata for safe recreate")
}

func dockerSDKVolumeName(svc *openlit.ServiceState) string {
	return "openlit-python-sdk-" + shortHash(svc.WorkloadKey)
}

func dockerManagedPythonPath(existingEnv []string) string {
	managedPath := fmt.Sprintf("%s/%s:%s/%s", openlitInstrumentationMountPath, pythonSDKBootstrapDirName, openlitInstrumentationMountPath, pythonSDKPackagesDirName)
	for _, entry := range existingEnv {
		key, value, ok := strings.Cut(entry, "=")
		if ok && key == "PYTHONPATH" && value != "" {
			if strings.Contains(value, managedPath) {
				return value
			}
			return managedPath + ":" + value
		}
	}
	return managedPath
}

func dockerInspectEnv(inspect map[string]any) map[string]string {
	env := make(map[string]string)
	for _, item := range extractStringList(dockerInspectConfig(inspect)["Env"]) {
		key, value, ok := strings.Cut(item, "=")
		if ok {
			env[key] = value
		}
	}
	return env
}

func dockerInspectCommand(inspect map[string]any) []string {
	config := dockerInspectConfig(inspect)
	command := make([]string, 0)
	command = append(command, extractStringList(config["Entrypoint"])...)
	command = append(command, extractStringList(config["Cmd"])...)
	return command
}

func dockerInspectConfig(inspect map[string]any) map[string]any {
	config, _ := inspect["Config"].(map[string]any)
	return config
}

func dockerInspectHostConfig(inspect map[string]any) map[string]any {
	hostConfig, _ := inspect["HostConfig"].(map[string]any)
	if hostConfig == nil {
		return map[string]any{}
	}
	return hostConfig
}

func dockerInspectHostConfigValue(inspect map[string]any, key string) any {
	return dockerInspectHostConfig(inspect)[key]
}

func dockerInspectName(inspect map[string]any) string {
	name, _ := inspect["Name"].(string)
	return name
}

func dockerInspectManagedConfigHash(inspect map[string]any) string {
	return extractStringMap(dockerInspectConfig(inspect)["Labels"])[openlitManagedConfigHash]
}

func dockerInspectImage(inspect map[string]any) string {
	image, _ := dockerInspectConfig(inspect)["Image"].(string)
	return image
}

func dockerInspectNetworkingConfig(inspect map[string]any) map[string]any {
	networkSettings, _ := inspect["NetworkSettings"].(map[string]any)
	networks, _ := networkSettings["Networks"].(map[string]any)
	if len(networks) == 0 {
		return nil
	}
	return map[string]any{
		"EndpointsConfig": networks,
	}
}

func upsertEnvString(env []string, key, value string) []string {
	for i, entry := range env {
		existingKey, _, ok := strings.Cut(entry, "=")
		if ok && existingKey == key {
			env[i] = key + "=" + value
			return env
		}
	}
	return append(env, key+"="+value)
}

func removeEnvString(env []string, key string) []string {
	filtered := make([]string, 0, len(env))
	for _, entry := range env {
		existingKey, _, ok := strings.Cut(entry, "=")
		if ok && existingKey == key {
			continue
		}
		filtered = append(filtered, entry)
	}
	return filtered
}

func rewritePythonPathWithoutManagedSDK(env []string) []string {
	filtered := make([]string, 0, len(env))
	managedPrefix := fmt.Sprintf("%s/%s:%s/%s", openlitInstrumentationMountPath, pythonSDKBootstrapDirName, openlitInstrumentationMountPath, pythonSDKPackagesDirName)
	for _, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if !ok || key != "PYTHONPATH" {
			filtered = append(filtered, entry)
			continue
		}
		value = strings.TrimPrefix(value, managedPrefix+":")
		value = strings.TrimPrefix(value, managedPrefix)
		if value != "" {
			filtered = append(filtered, key+"="+value)
		}
	}
	return filtered
}

func upsertBindMount(binds []string, mount string, target string) []string {
	for _, existing := range binds {
		if strings.HasSuffix(existing, ":"+target) {
			return binds
		}
	}
	return append(binds, mount)
}

func removeBindMount(binds []string, target string) []string {
	filtered := make([]string, 0, len(binds))
	for _, existing := range binds {
		if strings.HasSuffix(existing, ":"+target) {
			continue
		}
		filtered = append(filtered, existing)
	}
	return filtered
}

func extractStringList(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if str, ok := item.(string); ok {
				result = append(result, str)
			}
		}
		return result
	default:
		return nil
	}
}

func stringSliceToAny(values []string) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func extractStringMap(value any) map[string]string {
	switch typed := value.(type) {
	case map[string]string:
		copied := make(map[string]string, len(typed))
		for key, item := range typed {
			copied[key] = item
		}
		return copied
	case map[string]any:
		copied := make(map[string]string, len(typed))
		for key, item := range typed {
			if str, ok := item.(string); ok {
				copied[key] = str
			}
		}
		return copied
	default:
		return map[string]string{}
	}
}

func cloneMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	data, err := json.Marshal(source)
	if err != nil {
		result := make(map[string]any, len(source))
		for k, v := range source {
			result[k] = v
		}
		return result
	}
	var copied map[string]any
	if err := json.Unmarshal(data, &copied); err != nil {
		result := make(map[string]any, len(source))
		for k, v := range source {
			result[k] = v
		}
		return result
	}
	return copied
}

func copySelectedKeys(target map[string]any, source map[string]any, keys []string) {
	for _, key := range keys {
		if value, ok := source[key]; ok {
			target[key] = value
		}
	}
}

func sanitizeSystemdUnit(unit string) string {
	return strings.ReplaceAll(unit, "/", "_")
}

const bareProcessSDKStateDir = "/var/lib/openlit/python-sdk"

func (e *Engine) enablePythonSDKBareProcess(
	svc *openlit.ServiceState,
	payload openlit.PythonSDKActionPayload,
) error {
	pythonBinary := svc.ExePath
	if pythonBinary == "" {
		e.setDesiredAgentObservabilityState(
			svc.ID,
			"unsupported",
			"none",
			"",
			"Cannot determine the Python binary path for this process",
		)
		return fmt.Errorf("missing python executable path for bare process %s", svc.ServiceName)
	}

	fingerprint := shortHash(svc.WorkloadKey)
	sdkRoot := filepath.Join(bareProcessSDKStateDir, fingerprint)

	e.logger.Info("installing Python SDK for bare process (manual mode)",
		zap.String("service", svc.ServiceName),
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("sdk_root", sdkRoot),
		zap.String("python", pythonBinary),
	)

	if err := installPythonSDKFromPyPI(pythonBinary, sdkRoot, payload.SDKVersion); err != nil {
		e.setDesiredAgentObservabilityState(
			svc.ID,
			"error",
			"controller_managed",
			"",
			fmt.Sprintf("Failed to install OpenLIT SDK: %v", err),
		)
		return err
	}

	bootstrapDir := filepath.Join(sdkRoot, pythonSDKBootstrapDirName)
	packagesDir := filepath.Join(sdkRoot, pythonSDKPackagesDirName)
	pythonPath := bootstrapDir + ":" + packagesDir

	reason := fmt.Sprintf(
		"OpenLIT SDK installed at %s. To activate, set these environment variables and restart your process:\n"+
			"  PYTHONPATH=%s:$PYTHONPATH\n"+
			"  OPENLIT_CONTROLLER_MODE=agent_observability\n"+
			"  OTEL_SERVICE_NAME=%s\n"+
			"  OTEL_EXPORTER_OTLP_ENDPOINT=%s\n"+
			"  OPENLIT_DISABLED_INSTRUMENTORS=%s",
		sdkRoot,
		pythonPath,
		svc.ServiceName,
		payload.OTLPEndpoint,
		strings.Join(controllerManagedDisabledInstrumentors, ","),
	)

	e.setDesiredAgentObservabilityState(
		svc.ID,
		"manual",
		"controller_managed",
		"",
		reason,
	)

	e.logger.Info("bare process Agent O11y: SDK installed, manual activation required",
		zap.String("service", svc.ServiceName),
		zap.String("sdk_root", sdkRoot),
		zap.String("pythonpath", pythonPath),
	)

	return nil
}
