// Package signal converts stamped OTLP rows into compact OpenLIT Signals for
// the realtime bus. Signals never carry prompts, completions, events, or raw
// attribute maps.
package signal

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/openlit/openlit/otlp-receiver/internal/otlpconv"
)

const (
	Version       = 1
	SubjectPrefix = "openlit.signal"
	KindSpan      = "span"
)

var (
	ErrInvalidTenant = errors.New("signal: invalid tenant identifiers")
	idPattern        = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
)

type Tenant struct {
	OrganisationID   string
	ProjectID        string
	Environment      string
	DatabaseConfigID string
	APIKeyID         string
}

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

// Subject returns openlit.signal.<org>.<project>.<envtoken>. Identifiers that
// are not subject-safe are rejected rather than escaped so a crafted id can
// never widen into another tenant's subject space.
func Subject(t Tenant) (string, error) {
	if !idPattern.MatchString(t.OrganisationID) || !idPattern.MatchString(t.ProjectID) {
		return "", ErrInvalidTenant
	}
	env := EnvToken(t.Environment)
	if env == "" {
		return "", ErrInvalidTenant
	}
	return SubjectPrefix + "." + t.OrganisationID + "." + t.ProjectID + "." + env, nil
}

// EnvToken encodes an environment name into a single NATS subject token.
// Environment names allow dots, which NATS treats as token separators, so
// "_" is escaped as "__" and "." as "_d" to keep the mapping reversible.
func EnvToken(env string) string {
	env = strings.TrimSpace(env)
	if env == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range env {
		switch {
		case r == '_':
			b.WriteString("__")
		case r == '.':
			b.WriteString("_d")
		case r == '-' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
		default:
			return ""
		}
	}
	return b.String()
}

func IsGenAI(row otlpconv.TraceRow) bool {
	for k := range row.SpanAttributes {
		if strings.HasPrefix(k, "gen_ai.") {
			return true
		}
	}
	return false
}

func FromTrace(row otlpconv.TraceRow, t Tenant) Signal {
	attrs := row.SpanAttributes
	s := Signal{
		Version:          Version,
		Kind:             KindSpan,
		OrganisationID:   t.OrganisationID,
		ProjectID:        t.ProjectID,
		Environment:      t.Environment,
		DatabaseConfigID: t.DatabaseConfigID,
		APIKeyID:         t.APIKeyID,
		Timestamp:        row.Timestamp.UTC(),
		TraceID:          row.TraceID,
		SpanID:           row.SpanID,
		Service:          row.ServiceName,
		SpanName:         row.SpanName,
		Operation:        attrs["gen_ai.operation.name"],
		Provider:         first(attrs, "gen_ai.provider.name", "gen_ai.system"),
		Model:            first(attrs, "gen_ai.request.model", "gen_ai.response.model"),
		DurationMs:       float64(row.Duration) / 1e6,
		Status:           status(row.StatusCode),
		ErrorType:        attrs["error.type"],
		HTTPStatus:       int(parseInt(first(attrs, "http.response.status_code", "http.status_code"))),
		InputTokens:      parseInt(first(attrs, "gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens")),
		OutputTokens:     parseInt(first(attrs, "gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens")),
		TotalTokens:      parseInt(attrs["gen_ai.usage.total_tokens"]),
		Attrs:            Attributes(attrs, row.ResourceAttributes),
	}
	if s.TotalTokens == 0 {
		s.TotalTokens = s.InputTokens + s.OutputTokens
	}
	if raw := strings.TrimSpace(attrs["gen_ai.usage.cost"]); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil && v >= 0 {
			s.Cost = &v
		}
	}
	return s
}

// MsgID is the JetStream dedupe id so receiver retries publish once.
func MsgID(s Signal) string {
	return s.TraceID + ":" + s.SpanID
}

func status(code string) string {
	switch code {
	case "STATUS_CODE_ERROR":
		return "error"
	case "STATUS_CODE_OK":
		return "ok"
	default:
		return "unset"
	}
}

func first(attrs map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(attrs[k]); v != "" {
			return v
		}
	}
	return ""
}

func parseInt(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if v, err := strconv.ParseInt(raw, 10, 64); err == nil {
		return v
	}
	if f, err := strconv.ParseFloat(raw, 64); err == nil {
		return int64(f)
	}
	return 0
}
