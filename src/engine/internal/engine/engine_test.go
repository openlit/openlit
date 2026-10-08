package engine

import (
	"testing"
	"time"

	"github.com/openlit/openlit/engine/internal/rules"
	"github.com/openlit/openlit/engine/internal/signal"
)

type captureSink struct{ findings []Finding }

func (c *captureSink) Emit(f Finding) { c.findings = append(c.findings, f) }

func errorRateRule() rules.Rule {
	return rules.Rule{
		ID: "builtin.error_rate", Name: "Error rate", Kind: "threshold", Mode: rules.ModeWindow,
		Severity: "warning", GroupBy: []string{"service"}, Metric: "error_rate", Operator: "gt",
		Threshold: 0.5, WindowSec: 300, MinSamples: 4, CooldownSec: 60,
	}
}

func sig(org, project, env, status string) signal.Signal {
	return signal.Signal{OrganisationID: org, ProjectID: project, Environment: env, Service: "svc", Model: "m", Status: status, TraceID: "t", SpanID: "s"}
}

func newEngine(t *testing.T, rs ...rules.Rule) (*Engine, *captureSink, *time.Time) {
	t.Helper()
	sink := &captureSink{}
	e := New(sink)
	now := time.Unix(1_000_000, 0)
	e.now = func() time.Time { return now }
	if n := e.SetRules(rs); n != len(rs) {
		t.Fatalf("expected %d valid rules, got %d", len(rs), n)
	}
	return e, sink, &now
}

func TestWindowFiresAndResolves(t *testing.T) {
	e, sink, now := newEngine(t, errorRateRule())
	for i := 0; i < 4; i++ {
		e.Observe(sig("o", "p", "prod", "error"), *now)
	}
	e.Tick()
	if len(sink.findings) != 1 || sink.findings[0].State != StateFiring {
		t.Fatalf("expected firing, got %+v", sink.findings)
	}
	f := sink.findings[0]
	if f.OrganisationID != "o" || f.ProjectID != "p" || f.Environment != "prod" || f.Group["service"] != "svc" || f.Value != 1 {
		t.Fatalf("unexpected finding %+v", f)
	}
	e.Tick()
	if len(sink.findings) != 1 {
		t.Fatal("must not re-fire while firing")
	}
	*now = now.Add(301 * time.Second)
	e.Tick()
	if len(sink.findings) != 2 || sink.findings[1].State != StateResolved || sink.findings[1].DedupeKey != f.DedupeKey {
		t.Fatalf("expected resolve with same dedupe key, got %+v", sink.findings)
	}
}

func TestMinSamplesPreventsNoise(t *testing.T) {
	e, sink, now := newEngine(t, errorRateRule())
	e.Observe(sig("o", "p", "prod", "error"), *now)
	e.Tick()
	if len(sink.findings) != 0 {
		t.Fatal("single error must not fire")
	}
}

func TestTenantWindowsAreIsolated(t *testing.T) {
	e, sink, now := newEngine(t, errorRateRule())
	for i := 0; i < 2; i++ {
		e.Observe(sig("orgA", "p", "prod", "error"), *now)
		e.Observe(sig("orgB", "p", "prod", "error"), *now)
		e.Observe(sig("orgA", "p", "staging", "error"), *now)
	}
	e.Tick()
	if len(sink.findings) != 0 {
		t.Fatalf("samples from different tenants must not combine, got %+v", sink.findings)
	}
}

func TestScopedRuleOnlyAppliesToItsTenant(t *testing.T) {
	r := errorRateRule()
	r.ID = "custom.1"
	r.Scope = rules.Scope{OrganisationID: "orgA", ProjectID: "p"}
	e, sink, now := newEngine(t, r)
	for i := 0; i < 4; i++ {
		e.Observe(sig("orgB", "p", "prod", "error"), *now)
	}
	e.Tick()
	if len(sink.findings) != 0 {
		t.Fatal("rule scoped to orgA fired for orgB")
	}
	for i := 0; i < 4; i++ {
		e.Observe(sig("orgA", "p", "prod", "error"), *now)
	}
	e.Tick()
	if len(sink.findings) != 1 || sink.findings[0].OrganisationID != "orgA" {
		t.Fatalf("expected orgA finding, got %+v", sink.findings)
	}
}

func TestInstantRuleCooldown(t *testing.T) {
	r := rules.Rule{
		ID: "custom.compliance", Name: "Unapproved provider", Kind: "compliance", Mode: rules.ModeInstant,
		Severity: "critical", GroupBy: []string{"provider"}, CooldownSec: 60,
		Match: []rules.Condition{{Field: "provider", Op: "not_in", Values: []string{"openai"}}},
	}
	e, sink, now := newEngine(t, r)
	s := sig("o", "p", "prod", "ok")
	s.Provider = "deepseek"
	e.Observe(s, *now)
	e.Observe(s, *now)
	if len(sink.findings) != 1 || sink.findings[0].Kind != "compliance" {
		t.Fatalf("expected one compliance finding, got %+v", sink.findings)
	}
	allowed := s
	allowed.Provider = "openai"
	e.Observe(allowed, *now)
	if len(sink.findings) != 1 {
		t.Fatal("allowed provider must not fire")
	}
	*now = now.Add(61 * time.Second)
	e.Observe(s, *now)
	if len(sink.findings) != 2 {
		t.Fatal("expected re-fire after cooldown")
	}
}

func TestUnscopedSignalsIgnored(t *testing.T) {
	e, sink, now := newEngine(t, errorRateRule())
	for i := 0; i < 10; i++ {
		e.Observe(sig("", "p", "prod", "error"), *now)
	}
	e.Tick()
	if len(sink.findings) != 0 || e.Stats().Observed != 0 {
		t.Fatal("signals without full tenant must be ignored")
	}
}

func TestRecentKeepsEverySignalAndIsolatesTenants(t *testing.T) {
	e, _, now := newEngine(t)
	e.recentCap = 2
	a := sig("orgA", "p", "prod", "ok")
	a.Service = "first"
	b := sig("orgB", "p", "prod", "error")
	b.Service = "other"
	c := sig("orgA", "p", "prod", "ok")
	c.Service = "second"
	e.Observe(a, *now)
	e.Observe(b, *now)
	e.Observe(c, *now)
	got := e.Recent("orgA", "p", "prod", 10)
	if len(got) != 1 || got[0].Service != "second" {
		t.Fatalf("expected only the newest orgA signal, got %+v", got)
	}
	other := e.Recent("orgB", "p", "prod", 10)
	if len(other) != 1 || other[0].Service != "other" {
		t.Fatalf("orgB signal must stay visible, got %+v", other)
	}
	if e.Recent("", "p", "prod", 10) != nil || len(e.Recent("orgA", "p", "staging", 10)) != 0 {
		t.Fatal("missing or different tenant must return nothing")
	}
}

func TestInvalidRulesSkipped(t *testing.T) {
	e := New(nil)
	n := e.SetRules([]rules.Rule{
		{ID: "bad.metric", Mode: rules.ModeWindow, Metric: "nope", Operator: "gt", WindowSec: 60},
		{ID: "bad.mode", Mode: "x"},
		{ID: "bad.instant", Mode: rules.ModeInstant},
		{ID: "bad.prompt", Mode: rules.ModeInstant, Match: []rules.Condition{{Field: "gen_ai.prompt", Op: "contains", Values: []string{"x"}}}},
		errorRateRule(),
	})
	if n != 1 {
		t.Fatalf("expected 1 valid rule, got %d", n)
	}
}

func TestAttributeRuleFiresForAllowlistedField(t *testing.T) {
	rule := rules.Rule{
		ID: "custom.tool", Name: "Shell tool", Kind: "security", Mode: rules.ModeInstant,
		Severity: "critical", CooldownSec: 60,
		Match:   []rules.Condition{{Field: "gen_ai.tool.name", Op: "eq", Values: []string{"shell"}}},
		GroupBy: []string{"user.id"},
	}
	e, sink, now := newEngine(t, rule)
	miss := sig("o", "p", "prod", "ok")
	miss.Attrs = map[string]string{"gen_ai.tool.name": "search", "user.id": "u1", "gen_ai.prompt": "secret"}
	e.Observe(miss, *now)
	hit := sig("o", "p", "prod", "ok")
	hit.SpanID = "s2"
	hit.Attrs = map[string]string{"gen_ai.tool.name": "shell", "user.id": "u1", "gen_ai.prompt": "secret"}
	e.Observe(hit, *now)
	if len(sink.findings) != 1 || sink.findings[0].Group["user.id"] != "u1" {
		t.Fatalf("expected one finding grouped by user.id, got %+v", sink.findings)
	}
	recent := e.Recent("o", "p", "prod", 10)
	if len(recent) != 2 || recent[0].Attributes["gen_ai.tool.name"] != "shell" {
		t.Fatalf("inspector attributes = %+v", recent)
	}
	if _, ok := recent[0].Attributes["gen_ai.prompt"]; ok {
		t.Fatal("inspector must not show prompt text")
	}
}
