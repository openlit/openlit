package engine

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
)

// ProcessMetadata holds enriched metadata about a discovered process.
type ProcessMetadata struct {
	PID            int
	ExePath        string
	Cmdline        string
	ServiceName    string
	Runtime        string
	Namespace      string
	DeploymentName string
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

// EnrichProcess reads /proc for a given PID and enriches with container/K8s metadata.
func EnrichProcess(procRoot string, pid int, container *ContainerEnricher, mode config.DeployMode) *ProcessMetadata {
	cmdline := readCmdline(procRoot, pid)
	exePath := readExePath(procRoot, pid)
	meta := &ProcessMetadata{
		PID:         pid,
		ExePath:     exePath,
		Cmdline:     cmdline,
		ServiceName: processName(cmdline, exePath),
		Runtime:     detectRuntime(exePath, cmdline),
	}
	if container != nil && (mode == config.DeployDocker || mode == config.DeployKubernetes) {
		svc := &openlit.DiscoveredService{ServiceName: meta.ServiceName}
		container.Enrich(svc, procRoot, pid, mode)
		meta.ServiceName = svc.ServiceName
		meta.Namespace = svc.Namespace
		meta.DeploymentName = svc.DeploymentName
	}
	return meta
}
