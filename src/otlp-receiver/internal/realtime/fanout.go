// Package realtime decides which stamped rows reach the realtime bus.
package realtime

import (
	"encoding/json"
	"sync/atomic"

	"github.com/openlit/openlit/otlp-receiver/internal/otlpconv"
	"github.com/openlit/openlit/otlp-receiver/internal/signal"
	"github.com/openlit/openlit/otlp-receiver/internal/tenant"
)

type Transport interface {
	Publish(subject, msgID string, data []byte) bool
}

type SkipStats struct {
	Unscoped      uint64 `json:"unscoped"`
	InvalidTenant uint64 `json:"invalid_tenant"`
	NonGenAI      uint64 `json:"non_genai"`
	Enqueued      uint64 `json:"enqueued"`
}

type Fanout struct {
	transport     Transport
	unscoped      atomic.Uint64
	invalidTenant atomic.Uint64
	nonGenAI      atomic.Uint64
	enqueued      atomic.Uint64
}

func New(transport Transport) *Fanout {
	return &Fanout{transport: transport}
}

// PublishTraces runs after a successful ClickHouse insert. Unauthenticated
// (init-db fallback) and unscoped tenants never reach the bus because their
// rows cannot be attributed to an organisation, project, and environment.
func (f *Fanout) PublishTraces(t tenant.Tenant, rows []otlpconv.TraceRow) {
	if f == nil || f.transport == nil || len(rows) == 0 {
		return
	}
	if !t.Scoped || t.OrganisationID == "" || t.ProjectID == "" || t.Environment == "" {
		f.unscoped.Add(uint64(len(rows)))
		return
	}
	st := signal.Tenant{
		OrganisationID:   t.OrganisationID,
		ProjectID:        t.ProjectID,
		Environment:      t.Environment,
		DatabaseConfigID: t.DatabaseConfigID,
		APIKeyID:         t.APIKeyID,
	}
	subject, err := signal.Subject(st)
	if err != nil {
		f.invalidTenant.Add(uint64(len(rows)))
		return
	}
	for _, row := range rows {
		if !signal.IsGenAI(row) {
			f.nonGenAI.Add(1)
			continue
		}
		s := signal.FromTrace(row, st)
		data, err := json.Marshal(s)
		if err != nil {
			continue
		}
		if f.transport.Publish(subject, signal.MsgID(s), data) {
			f.enqueued.Add(1)
		}
	}
}

func (f *Fanout) Stats() SkipStats {
	if f == nil {
		return SkipStats{}
	}
	return SkipStats{
		Unscoped:      f.unscoped.Load(),
		InvalidTenant: f.invalidTenant.Load(),
		NonGenAI:      f.nonGenAI.Load(),
		Enqueued:      f.enqueued.Load(),
	}
}
