package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/openlit/openlit/engine/internal/engine"
	sig "github.com/openlit/openlit/engine/internal/signal"
)

func TestSubjectMatches(t *testing.T) {
	s := sig.Signal{OrganisationID: "o", ProjectID: "p", Environment: "prod.eu"}
	if !subjectMatches("openlit.signal.o.p.prod_deu", s) {
		t.Fatal("expected match")
	}
	if subjectMatches("openlit.signal.other.p.prod_deu", s) {
		t.Fatal("forged organisation must be rejected")
	}
	if subjectMatches("openlit.signal.o.p.staging", s) {
		t.Fatal("environment mismatch must be rejected")
	}
	if subjectMatches("openlit.signal.o.p", s) {
		t.Fatal("short subject must be rejected")
	}
}

func TestSignalsHandlerScopesAndAuthenticates(t *testing.T) {
	eng := engine.New(nil)
	eng.Observe(sig.Signal{OrganisationID: "orgA", ProjectID: "p", Environment: "prod", Service: "a"}, time.Unix(10, 0))
	eng.Observe(sig.Signal{OrganisationID: "orgB", ProjectID: "p", Environment: "prod", Service: "b"}, time.Unix(11, 0))

	denied := httptest.NewRequest(http.MethodGet, "/signals?organisation_id=orgA&project_id=p&environment=prod", nil)
	rec := httptest.NewRecorder()
	signalsHandler(rec, denied, "s3cret", eng)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing secret: %d", rec.Code)
	}

	ok := httptest.NewRequest(http.MethodGet, "/signals?organisation_id=orgA&project_id=p&environment=prod", nil)
	ok.Header.Set("X-CRON-JOB", "s3cret")
	rec = httptest.NewRecorder()
	signalsHandler(rec, ok, "s3cret", eng)
	body := rec.Body.String()
	if rec.Code != http.StatusOK || !strings.Contains(body, `"service":"a"`) || strings.Contains(body, `"service":"b"`) {
		t.Fatalf("scoped body = %d %s", rec.Code, body)
	}
}
