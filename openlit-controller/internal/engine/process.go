package engine

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
)

// ProcessMetadata holds enriched metadata about a discovered process.
type ProcessMetadata struct {
	PID                      int
	ExePath                  string
	Cmdline                  string
	ServiceName              string
	Runtime                  string
	Namespace                string
	DeploymentName           string
	WorkloadKind             string
	PodName                  string
	PodUID                   string
	ContainerID              string
	ContainerName            string
	IsContainerized          bool
	SystemdUnit              string
	SystemdUserService       bool
	AgentObservabilityStatus string
	AgentObservabilitySource string
	ObservabilityConflict    string
	ObservabilityReason      string
}

func readCmdline(procRoot string, pid int) string {
	data, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "cmdline"))
	if err != nil {
		return ""
	}
	return strings.ReplaceAll(string(data), "\x00", " ")
}

func readExePath(procRoot string, pid int) string {
	link, err := os.Readlink(filepath.Join(procRoot, strconv.Itoa(pid), "exe"))
	if err != nil {
		return ""
	}
	return link
}

func readCwd(procRoot string, pid int) string {
	link, err := os.Readlink(filepath.Join(procRoot, strconv.Itoa(pid), "cwd"))
	if err != nil {
		return ""
	}
	return link
}

func readCmdlineArgs(procRoot string, pid int) []string {
	data, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "cmdline"))
	if err != nil || len(data) == 0 {
		return nil
	}
	data = bytes.TrimRight(data, "\x00")
	if len(data) == 0 {
		return nil
	}
	return strings.Split(string(data), "\x00")
}

func readEnviron(procRoot string, pid int) map[string]string {
	data, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "environ"))
	if err != nil || len(data) == 0 {
		return nil
	}

	env := make(map[string]string)
	for _, entry := range strings.Split(string(data), "\x00") {
		if entry == "" {
			continue
		}
		key, value, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}
		env[key] = value
	}
	return env
}

func readCgroup(procRoot string, pid int) string {
	data, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "cgroup"))
	if err != nil {
		return ""
	}
	return string(data)
}

func processName(cmdline, exePath string) string {
	if cmdline != "" {
		parts := strings.Fields(cmdline)
		if len(parts) > 0 {
			name := filepath.Base(parts[0])
			if name == "python" || name == "python3" || name == "python3.11" || name == "python3.12" {
				for _, arg := range parts[1:] {
					if !strings.HasPrefix(arg, "-") {
						return filepath.Base(arg)
					}
				}
			}
			return name
		}
	}
	if exePath != "" {
		return filepath.Base(exePath)
	}
	return "unknown"
}

func detectRuntime(exePath, cmdline string) string {
	lower := strings.ToLower(exePath + " " + cmdline)
	switch {
	case strings.Contains(lower, "python"):
		return "python"
	case strings.Contains(lower, "node"):
		return "nodejs"
	case strings.Contains(lower, "java"):
		return "java"
	case strings.Contains(lower, "ruby"):
		return "ruby"
	case strings.Contains(lower, "dotnet"):
		return "dotnet"
	default:
		return ""
	}
}

func detectContainerFromCgroup(cgroup string) (containerID string, isContainerized bool) {
	for _, line := range strings.Split(cgroup, "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 3)
		if len(parts) != 3 {
			continue
		}
		path := parts[2]
		for _, marker := range []string{"docker/", "containerd/", "crio-", "lxc/"} {
			idx := strings.LastIndex(path, marker)
			if idx >= 0 {
				raw := path[idx+len(marker):]
				raw = strings.TrimSuffix(raw, ".scope")
				raw = strings.Split(raw, "/")[0]
				if len(raw) >= 12 {
					return raw, true
				}
				return "", true
			}
		}
	}
	return "", false
}

func detectSystemdUnit(cgroup string) (unit string, isUserService bool) {
	for _, line := range strings.Split(cgroup, "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 3)
		if len(parts) != 3 {
			continue
		}
		path := parts[2]
		segments := strings.Split(path, "/")
		for _, segment := range segments {
			if strings.HasSuffix(segment, ".service") {
				return segment, strings.Contains(path, "/user.slice/")
			}
		}
	}
	return "", false
}

func detectAgentObservability(runtime, cmdline string, env map[string]string) (status, source, conflict, reason string) {
	if runtime != "python" {
		return "unsupported", "none", "", "Agent observability is only available for Python runtimes"
	}

	preflight := evaluatePythonSDKPreflight(env, strings.Fields(cmdline), defaultDuplicatePolicy)
	switch preflight.Decision {
	case pythonSDKDecisionAdopt:
		return "enabled", preflight.Source, "", preflight.Reason
	case pythonSDKDecisionBlock:
		return "disabled", preflight.Source, preflight.Conflict, preflight.Reason
	default:
		return "disabled", "none", "", "Python runtime detected but OpenLIT Python SDK not enabled"
	}
}

func hasAnyEnvWithPrefix(env map[string]string, prefix string) bool {
	for key, value := range env {
		if strings.HasPrefix(key, prefix) && value != "" {
			return true
		}
	}
	return false
}

// EnrichProcess reads /proc for a given PID and enriches with container/K8s metadata.
func EnrichProcess(procRoot string, pid int, container *ContainerEnricher, mode config.DeployMode) *ProcessMetadata {
	cmdline := readCmdline(procRoot, pid)
	exePath := readExePath(procRoot, pid)
	env := readEnviron(procRoot, pid)
	cgroup := readCgroup(procRoot, pid)
	systemdUnit, systemdUserService := detectSystemdUnit(cgroup)
	agentStatus, agentSource, conflict, reason := detectAgentObservability(
		detectRuntime(exePath, cmdline),
		cmdline,
		env,
	)
	cgroupContainerID, isContainerized := detectContainerFromCgroup(cgroup)

	meta := &ProcessMetadata{
		PID:                      pid,
		ExePath:                  exePath,
		Cmdline:                  cmdline,
		ServiceName:              processName(cmdline, exePath),
		Runtime:                  detectRuntime(exePath, cmdline),
		IsContainerized:          isContainerized,
		SystemdUnit:              systemdUnit,
		SystemdUserService:       systemdUserService,
		AgentObservabilityStatus: agentStatus,
		AgentObservabilitySource: agentSource,
		ObservabilityConflict:    conflict,
		ObservabilityReason:      reason,
	}
	if cgroupContainerID != "" {
		meta.ContainerID = cgroupContainerID
	}
	if container != nil && (mode == config.DeployDocker || mode == config.DeployKubernetes) {
		svc := &openlit.DiscoveredService{ServiceName: meta.ServiceName}
		containerMeta := container.Enrich(svc, procRoot, pid, mode)
		meta.ServiceName = svc.ServiceName
		meta.Namespace = svc.Namespace
		meta.DeploymentName = svc.DeploymentName
		if containerMeta != nil {
			meta.PodName = containerMeta.PodName
			meta.PodUID = containerMeta.PodUID
			meta.ContainerID = containerMeta.ContainerID
			meta.ContainerName = containerMeta.ContainerName
			meta.WorkloadKind = containerMeta.WorkloadKind
			meta.IsContainerized = true
		}
	}
	return meta
}

func envMapToSlice(env map[string]string) []string {
	s := make([]string, 0, len(env))
	for k, v := range env {
		s = append(s, k+"="+v)
	}
	return s
}

func waitForProcessExit(pid int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(pid, 0); err != nil {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}

func restartProcess(procRoot string, pid int, fullEnv map[string]string) (int, error) {
	args := readCmdlineArgs(procRoot, pid)
	if len(args) == 0 {
		return 0, fmt.Errorf("cannot read cmdline for pid %d", pid)
	}

	cwd := readCwd(procRoot, pid)
	if cwd == "" {
		cwd = "/"
	}

	if err := syscall.Kill(pid, syscall.SIGTERM); err != nil {
		return 0, fmt.Errorf("SIGTERM pid %d: %w", pid, err)
	}

	if !waitForProcessExit(pid, 5*time.Second) {
		_ = syscall.Kill(pid, syscall.SIGKILL)
		waitForProcessExit(pid, 2*time.Second)
	}

	cmd := exec.Command(args[0], args[1:]...)
	cmd.Dir = cwd
	cmd.Env = envMapToSlice(fullEnv)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Stdout = nil
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("start new process: %w", err)
	}

	go func() { _ = cmd.Wait() }()

	return cmd.Process.Pid, nil
}

func restartProcessWithEnv(procRoot string, pid int, envOverrides map[string]string) (int, error) {
	existingEnv := readEnviron(procRoot, pid)
	if existingEnv == nil {
		existingEnv = make(map[string]string)
	}
	for k, v := range envOverrides {
		existingEnv[k] = v
	}
	return restartProcess(procRoot, pid, existingEnv)
}

func restartProcessWithoutKeys(procRoot string, pid int, keysToRemove []string) (int, error) {
	existingEnv := readEnviron(procRoot, pid)
	if existingEnv == nil {
		existingEnv = make(map[string]string)
	}
	cleaned := stripEnvOverrides(existingEnv, keysToRemove)
	return restartProcess(procRoot, pid, cleaned)
}

func stripEnvOverrides(env map[string]string, keysToRemove []string) map[string]string {
	cleaned := make(map[string]string, len(env))
	for k, v := range env {
		cleaned[k] = v
	}
	for _, key := range keysToRemove {
		delete(cleaned, key)
	}
	return cleaned
}
