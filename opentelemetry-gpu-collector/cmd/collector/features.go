package main

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
)

// featureReport splits init outcomes into environment unavailability (soft)
// and collector faults / invalid configuration (fatal).
type featureReport struct {
	unavailable []config.FeatureFailure
	faults      []config.FeatureFailure
}

func (r *featureReport) unavailableFeature(logger *slog.Logger, name, reason string) {
	if r == nil {
		return
	}
	if logger != nil {
		logger.Info("feature unavailable", "feature", name, "reason", reason)
	}
	r.unavailable = append(r.unavailable, config.FeatureFailure{Name: name, Reason: reason})
}

func (r *featureReport) fault(logger *slog.Logger, name, reason string) {
	if r == nil {
		return
	}
	if logger != nil {
		logger.Error("feature fault",
			"feature", name,
			"reason", reason,
			"hint", "collector bug or invalid configuration — not an optional soft-fail",
		)
	}
	r.faults = append(r.faults, config.FeatureFailure{Name: name, Reason: reason})
}

// err returns a non-nil error when any collector fault was recorded.
func (r *featureReport) err() error {
	if r == nil || len(r.faults) == 0 {
		return nil
	}
	parts := make([]string, 0, len(r.faults))
	for _, ff := range r.faults {
		parts = append(parts, fmt.Sprintf("%s: %s", ff.Name, ff.Reason))
	}
	return fmt.Errorf("collector feature faults: %s", strings.Join(parts, "; "))
}

func failureNames(failures []config.FeatureFailure) []string {
	out := make([]string, 0, len(failures))
	for _, ff := range failures {
		out = append(out, ff.Name)
	}
	return out
}
