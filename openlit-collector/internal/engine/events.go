package engine

import (
	"context"
	"fmt"
	"time"

	"github.com/openlit/openlit/openlit-collector/internal/scanner"
	"github.com/openlit/openlit/openlit-collector/internal/openlit"
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

func (e *Engine) handleLLMEvent(ev scanner.LLMConnectEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()

	meta := EnrichProcess(e.procRoot, int(ev.PID), e.container, e.deployMode)
	id := serviceID(meta.ServiceName, meta.Namespace)

	if existing, ok := e.services[id]; ok {
		existing.LastSeen = time.Now()
		existing.LLMProviders = mergeProviders(existing.LLMProviders, []string{ev.Provider})
		existing.PID = int(ev.PID)
		return
	}

	e.services[id] = &openlit.ServiceState{
		ID:                    id,
		ServiceName:           meta.ServiceName,
		Namespace:             meta.Namespace,
		LanguageRuntime:       meta.Runtime,
		LLMProviders:          []string{ev.Provider},
		DeploymentName:        meta.DeploymentName,
		InstrumentationStatus: "discovered",
		FirstSeen:             time.Now(),
		LastSeen:              time.Now(),
		PID:                   int(ev.PID),
		ExePath:               meta.ExePath,
		Cmdline:               meta.Cmdline,
	}
	e.logger.Info("discovered LLM service",
		zap.String("service", meta.ServiceName),
		zap.Uint32("pid", ev.PID),
		zap.String("provider", ev.Provider),
	)
}

func serviceID(serviceName, namespace string) string {
	if namespace != "" {
		return fmt.Sprintf("%s/%s", namespace, serviceName)
	}
	return serviceName
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
