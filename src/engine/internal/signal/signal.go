// Package signal mirrors the receiver's compact OpenLIT Signal (version 1).
package signal

import "time"

type Signal struct {
	Version          int               `json:"v"`
	Kind             string            `json:"kind"`
	OrganisationID   string            `json:"organisation_id"`
	ProjectID        string            `json:"project_id"`
	Environment      string            `json:"environment"`
	DatabaseConfigID string            `json:"database_config_id,omitempty"`
	APIKeyID         string            `json:"api_key_id,omitempty"`
	Timestamp        time.Time         `json:"timestamp"`
	TraceID          string            `json:"trace_id"`
	SpanID           string            `json:"span_id"`
	Service          string            `json:"service,omitempty"`
	SpanName         string            `json:"span_name,omitempty"`
	Operation        string            `json:"operation,omitempty"`
	Provider         string            `json:"provider,omitempty"`
	Model            string            `json:"model,omitempty"`
	DurationMs       float64           `json:"duration_ms"`
	Status           string            `json:"status"`
	ErrorType        string            `json:"error_type,omitempty"`
	HTTPStatus       int               `json:"http_status,omitempty"`
	InputTokens      int64             `json:"input_tokens,omitempty"`
	OutputTokens     int64             `json:"output_tokens,omitempty"`
	TotalTokens      int64             `json:"total_tokens,omitempty"`
	Cost             *float64          `json:"cost,omitempty"`
	Attrs            map[string]string `json:"attrs,omitempty"`
}

// Field returns the string form of a filterable/groupable signal field.
func (s Signal) Field(name string) (string, bool) {
	switch name {
	case "service":
		return s.Service, true
	case "model":
		return s.Model, true
	case "provider":
		return s.Provider, true
	case "operation":
		return s.Operation, true
	case "status":
		return s.Status, true
	case "error_type":
		return s.ErrorType, true
	case "environment":
		return s.Environment, true
	case "span_name":
		return s.SpanName, true
	}
	if value, ok := s.attribute(name); ok {
		return value, true
	}
	return "", false
}

// Number returns a numeric signal field.
func (s Signal) Number(name string) (float64, bool) {
	switch name {
	case "http_status":
		return float64(s.HTTPStatus), true
	case "duration_ms":
		return s.DurationMs, true
	case "input_tokens":
		return float64(s.InputTokens), true
	case "output_tokens":
		return float64(s.OutputTokens), true
	case "total_tokens":
		return float64(s.TotalTokens), true
	case "cost":
		if s.Cost == nil {
			return 0, false
		}
		return *s.Cost, true
	}
	if value, ok := s.attributeNumber(name); ok {
		return value, true
	}
	return 0, false
}
