package engine

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
	"github.com/openlit/openlit/openlit-controller/internal/scanner"
	"go.uber.org/zap"
)

func (e *Engine) consumeScannerEvents(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-e.scanner.Events():
			e.handleLLMEvent(ev)
		}
	}
}

var ignoredServiceNames = map[string]bool{
	"pause":   true,
	"unknown": true,
	"":        true,
}

func (e *Engine) handleLLMEvent(ev scanner.LLMConnectEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()

	meta := EnrichProcess(e.procRoot, int(ev.PID), e.container, e.deployMode)

	if ignoredServiceNames[meta.ServiceName] {
		return
	}

	id := serviceID(meta, e.deployMode)
	now := time.Now()
	svcAttrs := buildServiceResourceAttrs(meta, int(ev.PID), e.deployMode)

	if existing, ok := e.services[id]; ok {
		prevProviderCount := len(existing.LLMProviders)
		existing.ServiceName = meta.ServiceName
		existing.Namespace = meta.Namespace
		existing.WorkloadKey = id
		existing.LanguageRuntime = meta.Runtime
		existing.DeploymentName = meta.DeploymentName
		existing.LastSeen = now
		existing.LLMProviders = mergeProviders(existing.LLMProviders, []string{ev.Provider})
		existing.PID = int(ev.PID)
		existing.ExePath = meta.ExePath
		existing.Cmdline = meta.Cmdline
		existing.ResourceAttributes = svcAttrs
		if existing.InstrumentationStatus == "instrumented" {
			providersChanged := len(existing.LLMProviders) != prevProviderCount
			nextPattern := derivePattern(existing, e.deployMode)
			if currentPattern, ok := e.patterns[id]; !ok || !instrumentPatternEqual(currentPattern, nextPattern) || providersChanged {
				e.patterns[id] = nextPattern
				if err := e.rebuildOBI(); err != nil {
					e.logger.Warn("failed to refresh workload selectors",
						zap.String("service", existing.ServiceName),
						zap.Error(err),
					)
				}
			}
		}
		return
	}

	e.services[id] = &openlit.ServiceState{
		ID:                    id,
		ServiceName:           meta.ServiceName,
		WorkloadKey:           id,
		Namespace:             meta.Namespace,
		LanguageRuntime:       meta.Runtime,
		LLMProviders:          []string{ev.Provider},
		DeploymentName:        meta.DeploymentName,
		InstrumentationStatus: "discovered",
		FirstSeen:             now,
		LastSeen:              now,
		PID:                   int(ev.PID),
		ExePath:               meta.ExePath,
		Cmdline:               meta.Cmdline,
		ResourceAttributes:    svcAttrs,
	}
	e.logger.Info("discovered LLM service",
		zap.String("service", meta.ServiceName),
		zap.Uint32("pid", ev.PID),
		zap.String("provider", ev.Provider),
	)
}

func serviceID(meta *ProcessMetadata, mode config.DeployMode) string {
	if workloadKey := buildWorkloadKey(meta, mode); workloadKey != "" {
		return workloadKey
	}
	if meta.Namespace != "" {
		return fmt.Sprintf("%s/%s", meta.Namespace, meta.ServiceName)
	}
	return meta.ServiceName
}

func buildWorkloadKey(meta *ProcessMetadata, mode config.DeployMode) string {
	switch mode {
	case config.DeployKubernetes:
		if meta.PodUID != "" {
			return fmt.Sprintf("k8s:%s:%s:%s", meta.Namespace, meta.PodUID, workloadContainerKey(meta))
		}
		if meta.PodName != "" {
			return fmt.Sprintf("k8s:%s:%s:%s", meta.Namespace, meta.PodName, workloadContainerKey(meta))
		}
	case config.DeployDocker:
		if meta.ContainerID != "" {
			return fmt.Sprintf("docker:%s", meta.ContainerID)
		}
		if meta.ContainerName != "" {
			return fmt.Sprintf("docker:%s", meta.ContainerName)
		}
	}

	fingerprint := strings.TrimSpace(meta.ExePath + "|" + meta.Cmdline)
	if fingerprint != "" {
		return fmt.Sprintf("linux:%d:%s", meta.PID, shortHash(fingerprint))
	}

	if meta.PID > 0 {
		return fmt.Sprintf("linux:%d:%s", meta.PID, meta.ServiceName)
	}

	return ""
}

func workloadContainerKey(meta *ProcessMetadata) string {
	switch {
	case meta.ContainerName != "":
		return meta.ContainerName
	case meta.ContainerID != "":
		return meta.ContainerID
	case meta.ServiceName != "":
		return meta.ServiceName
	default:
		return "process"
	}
}

func shortHash(value string) string {
	sum := sha1.Sum([]byte(value))
	return hex.EncodeToString(sum[:6])
}

func buildServiceResourceAttrs(meta *ProcessMetadata, pid int, mode config.DeployMode) map[string]string {
	attrs := make(map[string]string)

	if meta.Runtime != "" {
		attrs["process.runtime.name"] = meta.Runtime
	}
	attrs["process.pid"] = strconv.Itoa(pid)
	if meta.ExePath != "" {
		attrs["process.executable.path"] = meta.ExePath
	}
	if workloadKey := buildWorkloadKey(meta, mode); workloadKey != "" {
		attrs["service.workload.key"] = workloadKey
	}

	switch mode {
	case config.DeployKubernetes:
		if meta.DeploymentName != "" {
			attrs["k8s.deployment.name"] = meta.DeploymentName
		}
		if meta.Namespace != "" {
			attrs["k8s.namespace.name"] = meta.Namespace
		}
		if meta.PodName != "" {
			attrs["k8s.pod.name"] = meta.PodName
		}
		if meta.PodUID != "" {
			attrs["k8s.pod.uid"] = meta.PodUID
		}
		if meta.ContainerName != "" {
			attrs["container.name"] = meta.ContainerName
		}
		if meta.ContainerID != "" {
			attrs["container.id"] = meta.ContainerID
		}
		if v := os.Getenv("NODE_NAME"); v != "" {
			attrs["k8s.node.name"] = v
		}
	case config.DeployDocker:
		if meta.ContainerName != "" {
			attrs["container.name"] = meta.ContainerName
		} else if meta.ServiceName != "" {
			attrs["container.name"] = meta.ServiceName
		}
		if meta.ContainerID != "" {
			attrs["container.id"] = meta.ContainerID
		}
	}

	return attrs
}

func mergeProviders(existing, incoming []string) []string {
	set := make(map[string]struct{})
	for _, p := range existing {
		set[p] = struct{}{}
	}
	for _, p := range incoming {
		set[p] = struct{}{}
	}
	result := make([]string, 0, len(set))
	for p := range set {
		result = append(result, p)
	}
	return result
}
