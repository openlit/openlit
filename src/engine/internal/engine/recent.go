package engine

import (
	"container/list"
	"time"

	"github.com/openlit/openlit/engine/internal/signal"
)

const recentPerTenant = 200

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

// recentStore keeps a fixed-size ring of signals per tenant for the
// inspector. Tenants are evicted least-recently-seen first, so one noisy
// tenant can neither push out another tenant's signals nor grow memory.
// Callers hold e.mu.
type recentStore struct {
	maxTenants int
	perTenant  int
	tenants    map[tenantKey]*list.Element
	lru        *list.List
}

type recentRing struct {
	tenant tenantKey
	buf    []ObservedSignal
	next   int
	n      int
}

func (r *recentStore) configure(maxTenants, perTenant int) {
	r.maxTenants = maxTenants
	r.perTenant = perTenant
	r.tenants = map[tenantKey]*list.Element{}
	r.lru = list.New()
}

func (r *recentStore) remember(s signal.Signal, at time.Time) {
	tk := tenantKey{s.OrganisationID, s.ProjectID, s.Environment}
	el, ok := r.tenants[tk]
	if !ok {
		el = r.lru.PushFront(&recentRing{tenant: tk, buf: make([]ObservedSignal, r.perTenant)})
		r.tenants[tk] = el
		for r.lru.Len() > r.maxTenants {
			oldest := r.lru.Back()
			r.lru.Remove(oldest)
			delete(r.tenants, oldest.Value.(*recentRing).tenant)
		}
	} else {
		r.lru.MoveToFront(el)
	}
	ring := el.Value.(*recentRing)
	var cost *float64
	if s.Cost != nil {
		v := *s.Cost
		cost = &v
	}
	ring.buf[ring.next] = ObservedSignal{
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
	}
	ring.next = (ring.next + 1) % len(ring.buf)
	if ring.n < len(ring.buf) {
		ring.n++
	}
}

// Recent returns the newest signals for one tenant, up to limit.
func (e *Engine) Recent(org, project, env string, limit int) []ObservedSignal {
	if org == "" || project == "" || env == "" || limit <= 0 {
		return nil
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]ObservedSignal, 0, limit)
	el, ok := e.recent.tenants[tenantKey{org, project, env}]
	if !ok {
		return out
	}
	ring := el.Value.(*recentRing)
	for i := 0; i < ring.n && len(out) < limit; i++ {
		idx := (ring.next - 1 - i + len(ring.buf)) % len(ring.buf)
		out = append(out, ring.buf[idx])
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
