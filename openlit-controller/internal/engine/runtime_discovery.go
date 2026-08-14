package engine

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/openlit/openlit/openlit-controller/internal/openlit"
	"go.uber.org/zap"
)

const runtimeDiscoveryInterval = 10 * time.Second

var nodeAgentProviderPackages = map[string]string{
	"@openai/agents": "openai",
}

func (e *Engine) discoverRuntimeServicesLoop(ctx context.Context) {
	ticker := time.NewTicker(runtimeDiscoveryInterval)
	defer ticker.Stop()

	e.discoverRuntimeServices()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.discoverRuntimeServices()
		}
	}
}

func (e *Engine) discoverRuntimeServices() {
	pids := listProcPIDs(e.procRoot)
	for _, pid := range pids {
		cmdline := readCmdline(e.procRoot, pid)
		exePath := readExePath(e.procRoot, pid)
		runtime := detectRuntime(exePath, cmdline)
		if runtime != "nodejs" {
			continue
		}
		providers := detectNodeAgentProviders(e.procRoot, pid)
		if len(providers) == 0 {
			continue
		}

		meta := EnrichProcess(e.procRoot, pid, e.container, e.deployMode)
		if ignoredServiceNames[meta.ServiceName] {
			continue
		}
		e.upsertRuntimeDiscoveredService(meta, providers)
	}
}

func (e *Engine) upsertRuntimeDiscoveredService(meta *ProcessMetadata, providers []string) {
	id := serviceID(meta, e.deployMode)
	if id == "" {
		e.logger.Debug("skipping runtime discovery: could not resolve workload identity",
			zap.Int("pid", meta.PID),
			zap.String("service", meta.ServiceName),
		)
		return
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now()
	svcAttrs := buildServiceResourceAttrs(meta, meta.PID, e.deployMode)
	if existing, ok := e.services[id]; ok {
		existing.ServiceName = meta.ServiceName
		existing.Namespace = meta.Namespace
		existing.WorkloadKey = id
		existing.LanguageRuntime = meta.Runtime
		existing.DeploymentName = meta.DeploymentName
		applyObservedAgentObservability(existing, meta)
		existing.LastSeen = now
		existing.LLMProviders = mergeProviders(existing.LLMProviders, providers)
		existing.PID = meta.PID
		existing.ExePath = meta.ExePath
		existing.Cmdline = meta.Cmdline
		existing.ResourceAttributes = svcAttrs
		augmentServiceAttrsFromState(existing)
		return
	}

	e.services[id] = &openlit.ServiceState{
		ID:                       id,
		ServiceName:              meta.ServiceName,
		WorkloadKey:              id,
		Namespace:                meta.Namespace,
		LanguageRuntime:          meta.Runtime,
		LLMProviders:             providers,
		DeploymentName:           meta.DeploymentName,
		InstrumentationStatus:    "discovered",
		AgentObservabilityStatus: meta.AgentObservabilityStatus,
		AgentObservabilitySource: meta.AgentObservabilitySource,
		ObservabilityConflict:    meta.ObservabilityConflict,
		ObservabilityReason:      meta.ObservabilityReason,
		FirstSeen:                now,
		LastSeen:                 now,
		PID:                      meta.PID,
		ExePath:                  meta.ExePath,
		Cmdline:                  meta.Cmdline,
		ResourceAttributes:       svcAttrs,
	}
	augmentServiceAttrsFromState(e.services[id])
	e.logger.Info("discovered runtime AI service",
		zap.String("service", meta.ServiceName),
		zap.Int("pid", meta.PID),
		zap.Strings("providers", providers),
	)
}

func listProcPIDs(procRoot string) []int {
	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return nil
	}
	pids := make([]int, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err == nil && pid > 0 {
			pids = append(pids, pid)
		}
	}
	sort.Ints(pids)
	return pids
}

func detectNodeAgentProviders(procRoot string, pid int) []string {
	packagePath := packageJSONPathForProcess(procRoot, pid)
	if packagePath == "" {
		return nil
	}
	data, err := os.ReadFile(packagePath)
	if err != nil {
		return nil
	}

	var pkg struct {
		Dependencies         map[string]string `json:"dependencies"`
		DevDependencies      map[string]string `json:"devDependencies"`
		OptionalDependencies map[string]string `json:"optionalDependencies"`
		PeerDependencies     map[string]string `json:"peerDependencies"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil
	}

	providerSet := make(map[string]struct{})
	for _, deps := range []map[string]string{
		pkg.Dependencies,
		pkg.DevDependencies,
		pkg.OptionalDependencies,
		pkg.PeerDependencies,
	} {
		for dep := range deps {
			if provider, ok := nodeAgentProviderPackages[dep]; ok {
				providerSet[provider] = struct{}{}
			}
		}
	}

	providers := make([]string, 0, len(providerSet))
	for provider := range providerSet {
		providers = append(providers, provider)
	}
	sort.Strings(providers)
	return providers
}

func packageJSONPathForProcess(procRoot string, pid int) string {
	cwd := readCwd(procRoot, pid)
	if cwd == "" {
		return ""
	}
	cwd = strings.TrimPrefix(filepath.Clean(cwd), string(filepath.Separator))
	if cwd == "." {
		cwd = ""
	}
	return filepath.Join(procRoot, strconv.Itoa(pid), "root", cwd, "package.json")
}
