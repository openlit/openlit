package engine

import (
	"time"

	"github.com/openlit/openlit/engine/internal/signal"
)

const recentCap = 500

// ObservedSignal is one ingested GenAI span kept for the signal inspector.
// It never carries prompt text, API keys, or database credentials.
type ObservedSignal struct {
	Timestamp      time.Time         `json:"timestamp"`
	OrganisationID string            `json:"organisationId"`
	ProjectID      string            `json:"projectId"`
	Environment    string            `json:"environment"`
	Service        string            `json:"service,omitempty"`
	SpanName       string            `json:"spanName,omitempty"`
	Operation      string            `json:"operation,omitempty"`
	Provider       string            `json:"provider,omitempty"`
	Model          string            `json:"model,omitempty"`
	DurationMs     float64           `json:"durationMs"`
	Status         string            `json:"status"`
	HTTPStatus     int               `json:"httpStatus,omitempty"`
	InputTokens    int64             `json:"inputTokens,omitempty"`
	OutputTokens   int64             `json:"outputTokens,omitempty"`
	TotalTokens    int64             `json:"totalTokens,omitempty"`
	Cost           *float64          `json:"cost,omitempty"`
	TraceID        string            `json:"traceId,omitempty"`
	SpanID         string            `json:"spanId,omitempty"`
	Attributes     map[string]string `json:"attributes,omitempty"`
}

// remember stores a signal for the inspector. Caller holds e.mu.
func (e *Engine) remember(s signal.Signal, at time.Time) {
	capN := e.recentCap
	if capN <= 0 {
		capN = recentCap
	}
	var cost *float64
	if s.Cost != nil {
		v := *s.Cost
		cost = &v
	}
	e.recent = append(e.recent, ObservedSignal{
		Timestamp:      at.UTC(),
		OrganisationID: s.OrganisationID,
		ProjectID:      s.ProjectID,
		Environment:    s.Environment,
		Service:        s.Service,
		SpanName:       s.SpanName,
		Operation:      s.Operation,
		Provider:       s.Provider,
		Model:          s.Model,
		DurationMs:     s.DurationMs,
		Status:         s.Status,
		HTTPStatus:     s.HTTPStatus,
		InputTokens:    s.InputTokens,
		OutputTokens:   s.OutputTokens,
		TotalTokens:    s.TotalTokens,
		Cost:           cost,
		TraceID:        s.TraceID,
		SpanID:         s.SpanID,
		Attributes:     publicAttributes(s),
	})
	if extra := len(e.recent) - capN; extra > 0 {
		e.recent = append([]ObservedSignal(nil), e.recent[extra:]...)
	}
}

// Recent returns the newest matching signals for one tenant, up to limit.
func (e *Engine) Recent(org, project, env string, limit int) []ObservedSignal {
	if org == "" || project == "" || env == "" || limit <= 0 {
		return nil
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]ObservedSignal, 0, limit)
	for i := len(e.recent) - 1; i >= 0 && len(out) < limit; i-- {
		s := e.recent[i]
		if s.OrganisationID == org && s.ProjectID == project && s.Environment == env {
			out = append(out, s)
		}
	}
	return out
}

// publicAttributes keeps allowlisted values for the inspector and drops anything else.
func publicAttributes(s signal.Signal) map[string]string {
	if len(s.Attrs) == 0 {
		return nil
	}
	out := make(map[string]string, len(s.Attrs))
	for key, value := range s.Attrs {
		if !signal.AllowedAttribute(key) || value == "" {
			continue
		}
		out[key] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
