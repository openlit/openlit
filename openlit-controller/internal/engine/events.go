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
	selfPID := uint32(os.Getpid())
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-e.scanner.Events():
			if ev.PID == selfPID {
				continue
			}
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
	if id == "" {
		e.logger.Debug("skipping event: could not resolve workload identity",
			zap.Uint32("pid", ev.PID),
			zap.String("service", meta.ServiceName),
		)
		return
	}
	now := time.Now()
	svcAttrs := buildServiceResourceAttrs(meta, int(ev.PID), e.deployMode)

	if existing, ok := e.services[id]; ok {
		prevProviderCount := len(existing.LLMProviders)
		existing.ServiceName = meta.ServiceName
		existing.Namespace = meta.Namespace
		existing.WorkloadKey = id
		existing.LanguageRuntime = meta.Runtime
		existing.DeploymentName = meta.DeploymentName
		applyObservedAgentObservability(existing, meta)
		existing.LastSeen = now
		existing.LLMProviders = mergeProviders(existing.LLMProviders, []string{ev.Provider})
		existing.PID = int(ev.PID)
		existing.ExePath = meta.ExePath
		existing.Cmdline = meta.Cmdline
		existing.ResourceAttributes = svcAttrs
		augmentServiceAttrsFromState(existing)
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
		ID:                       id,
		ServiceName:              meta.ServiceName,
		WorkloadKey:              id,
		Namespace:                meta.Namespace,
		LanguageRuntime:          meta.Runtime,
		LLMProviders:             []string{ev.Provider},
		DeploymentName:           meta.DeploymentName,
		InstrumentationStatus:    "discovered",
		AgentObservabilityStatus: meta.AgentObservabilityStatus,
		AgentObservabilitySource: meta.AgentObservabilitySource,
		ObservabilityConflict:    meta.ObservabilityConflict,
		ObservabilityReason:      meta.ObservabilityReason,
		FirstSeen:                now,
		LastSeen:                 now,
		PID:                      int(ev.PID),
		ExePath:                  meta.ExePath,
		Cmdline:                  meta.Cmdline,
		ResourceAttributes:       svcAttrs,
	}
	augmentServiceAttrsFromState(e.services[id])
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
	if mode == config.DeployKubernetes || mode == config.DeployDocker {
		return ""
	}
	if meta.Namespace != "" {
		return fmt.Sprintf("%s/%s", meta.Namespace, meta.ServiceName)
	}
	return meta.ServiceName
}

func buildWorkloadKey(meta *ProcessMetadata, mode config.DeployMode) string {
	switch mode {
	case config.DeployKubernetes:
		cname := stableContainerName(meta)
		if meta.Namespace != "" && meta.DeploymentName != "" {
			return fmt.Sprintf("k8s:%s:%s:%s", meta.Namespace, meta.DeploymentName, cname)
		}
		if meta.PodName != "" {
			return fmt.Sprintf("k8s:%s:%s:%s", meta.Namespace, meta.PodName, cname)
		}
		if meta.PodUID != "" {
			return fmt.Sprintf("k8s:%s:%s:%s", meta.Namespace, meta.PodUID, cname)
		}
		// In K8s mode, if we couldn't resolve any K8s identity, return empty
		// so the event is skipped. The next scan cycle will pick it up once
		// the pod metadata is available.
		return ""
	case config.DeployDocker:
		if meta.ContainerName != "" {
			return fmt.Sprintf("docker:%s", meta.ContainerName)
		}
		if meta.ContainerID != "" {
			return fmt.Sprintf("docker:%s", meta.ContainerID)
		}
		return ""
	}

	if meta.SystemdUnit != "" {
		return fmt.Sprintf("linux:systemd:%s", meta.SystemdUnit)
	}

	fingerprint := strings.TrimSpace(meta.ExePath + "|" + meta.Cmdline)
	if fingerprint != "" {
		return fmt.Sprintf("linux:exe:%s", shortHash(fingerprint))
	}

	if meta.ServiceName != "" {
		return fmt.Sprintf("linux:proc:%s", meta.ServiceName)
	}

	return ""
}

func stableContainerName(meta *ProcessMetadata) string {
	if meta.ContainerName != "" {
		return meta.ContainerName
	}
	if meta.ServiceName != "" {
		return meta.ServiceName
	}
	return "default"
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
	if meta.AgentObservabilityStatus != "" {
		attrs["openlit.agent_observability.status"] = meta.AgentObservabilityStatus
	}
	if meta.AgentObservabilitySource != "" {
		attrs["openlit.agent_observability.source"] = meta.AgentObservabilitySource
	}
	if meta.ObservabilityConflict != "" {
		attrs["openlit.observability.conflict"] = meta.ObservabilityConflict
	}
	if meta.ObservabilityReason != "" {
		attrs["openlit.observability.reason"] = meta.ObservabilityReason
	}

	switch mode {
	case config.DeployKubernetes:
		if meta.DeploymentName != "" {
			attrs["k8s.deployment.name"] = meta.DeploymentName
		}
		if meta.WorkloadKind != "" {
			attrs["k8s.workload.kind"] = meta.WorkloadKind
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
	default:
		if meta.SystemdUnit != "" {
			attrs["systemd.unit"] = meta.SystemdUnit
			if meta.SystemdUserService {
				attrs["systemd.scope"] = "user"
			} else {
				attrs["systemd.scope"] = "system"
			}
		}
		if meta.IsContainerized {
			attrs["openlit.is_containerized"] = "true"
		}
		if meta.ContainerID != "" {
			attrs["container.id"] = meta.ContainerID
		}
		if meta.ContainerName != "" {
			attrs["container.name"] = meta.ContainerName
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

func applyObservedAgentObservability(svc *openlit.ServiceState, meta *ProcessMetadata) {
	if svc.DesiredAgentObservabilityStatus != "" {
		if svc.DesiredAgentObservabilityStatus == meta.AgentObservabilityStatus {
			svc.DesiredAgentObservabilityStatus = ""
			svc.DesiredAgentObservabilityReason = ""
		} else {
			svc.AgentObservabilityStatus = svc.DesiredAgentObservabilityStatus
			if svc.AgentObservabilitySource == "" {
				svc.AgentObservabilitySource = "controller_managed"
			}
			if svc.DesiredAgentObservabilityReason != "" {
				svc.ObservabilityReason = svc.DesiredAgentObservabilityReason
			}
			return
		}
	}

	svc.AgentObservabilityStatus = meta.AgentObservabilityStatus
	svc.AgentObservabilitySource = meta.AgentObservabilitySource
	svc.ObservabilityConflict = meta.ObservabilityConflict
	svc.ObservabilityReason = meta.ObservabilityReason
}

func augmentServiceAttrsFromState(svc *openlit.ServiceState) {
	if svc.ResourceAttributes == nil {
		svc.ResourceAttributes = make(map[string]string)
	}
	if svc.AgentObservabilityStatus != "" {
		svc.ResourceAttributes["openlit.agent_observability.status"] = svc.AgentObservabilityStatus
	}
	if svc.AgentObservabilitySource != "" {
		svc.ResourceAttributes["openlit.agent_observability.source"] = svc.AgentObservabilitySource
	}
	if svc.ObservabilityConflict != "" {
		svc.ResourceAttributes["openlit.observability.conflict"] = svc.ObservabilityConflict
	}
	if svc.ObservabilityReason != "" {
		svc.ResourceAttributes["openlit.observability.reason"] = svc.ObservabilityReason
	}
	if svc.DesiredAgentObservabilityStatus != "" {
		svc.ResourceAttributes["openlit.agent_observability.desired_status"] = svc.DesiredAgentObservabilityStatus
	}
}
