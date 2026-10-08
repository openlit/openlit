package realtime

import (
	"encoding/json"
	"testing"

	"github.com/openlit/openlit/otlp-receiver/internal/otlpconv"
	"github.com/openlit/openlit/otlp-receiver/internal/signal"
	"github.com/openlit/openlit/otlp-receiver/internal/tenant"
)

type published struct {
	subject, msgID string
	data           []byte
}

type fakeTransport struct{ msgs []published }

func (f *fakeTransport) Publish(subject, msgID string, data []byte) bool {
	f.msgs = append(f.msgs, published{subject, msgID, data})
	return true
}

func genAIRow(span string) otlpconv.TraceRow {
	return otlpconv.TraceRow{TraceID: "t", SpanID: span, SpanAttributes: map[string]string{"gen_ai.request.model": "m"}}
}

func TestTenantIsolationAcrossKeys(t *testing.T) {
	tr := &fakeTransport{}
	f := New(tr)
	a := tenant.Tenant{OrganisationID: "orgA", ProjectID: "projA", Environment: "production", Scoped: true}
	b := tenant.Tenant{OrganisationID: "orgB", ProjectID: "projB", Environment: "staging", Scoped: true}
	f.PublishTraces(a, []otlpconv.TraceRow{genAIRow("1")})
	f.PublishTraces(b, []otlpconv.TraceRow{genAIRow("2")})
	if len(tr.msgs) != 2 {
		t.Fatalf("got %d messages", len(tr.msgs))
	}
	if tr.msgs[0].subject != "openlit.signal.orgA.projA.production" || tr.msgs[1].subject != "openlit.signal.orgB.projB.staging" {
		t.Fatalf("subjects %q %q", tr.msgs[0].subject, tr.msgs[1].subject)
	}
	var s signal.Signal
	if err := json.Unmarshal(tr.msgs[1].data, &s); err != nil {
		t.Fatal(err)
	}
	if s.OrganisationID != "orgB" || s.ProjectID != "projB" || s.Environment != "staging" {
		t.Fatalf("payload tenant %+v", s)
	}
}

func TestSkipsUnscopedInvalidAndNonGenAI(t *testing.T) {
	tr := &fakeTransport{}
	f := New(tr)
	f.PublishTraces(tenant.Tenant{}, []otlpconv.TraceRow{genAIRow("1")})
	f.PublishTraces(tenant.Tenant{OrganisationID: "o", ProjectID: "p", Environment: "e", Scoped: false}, []otlpconv.TraceRow{genAIRow("2")})
	f.PublishTraces(tenant.Tenant{OrganisationID: "o.x", ProjectID: "p", Environment: "e", Scoped: true}, []otlpconv.TraceRow{genAIRow("3")})
	f.PublishTraces(tenant.Tenant{OrganisationID: "o", ProjectID: "p", Environment: "e", Scoped: true}, []otlpconv.TraceRow{{SpanAttributes: map[string]string{"http.method": "GET"}}})
	if len(tr.msgs) != 0 {
		t.Fatalf("expected no publishes, got %d", len(tr.msgs))
	}
	st := f.Stats()
	if st.Unscoped != 2 || st.InvalidTenant != 1 || st.NonGenAI != 1 {
		t.Fatalf("stats %+v", st)
	}
}

func TestNilFanoutIsSafe(t *testing.T) {
	var f *Fanout
	f.PublishTraces(tenant.Tenant{Scoped: true}, []otlpconv.TraceRow{genAIRow("1")})
}
