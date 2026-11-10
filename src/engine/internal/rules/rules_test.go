package rules

import (
	"testing"

	"github.com/openlit/openlit/engine/internal/signal"
)

func TestCompute(t *testing.T) {
	t.Parallel()
	samples := []Sample{
		{DurationMs: 10, Error: true, Tokens: 5, Cost: 1, HasCost: true},
		{DurationMs: 20, Tokens: 5},
		{DurationMs: 30, Tokens: 5, Cost: 2, HasCost: true},
		{DurationMs: 1000, Error: true, Tokens: 5},
	}
	cases := map[string]float64{
		"count": 4, "error_count": 2, "error_rate": 0.5,
		"avg_latency_ms": 265, "p95_latency_ms": 1000, "total_tokens": 20, "cost": 3,
	}
	for metric, want := range cases {
		if got := Compute(metric, samples); got != want {
			t.Fatalf("%s = %v, want %v", metric, got, want)
		}
	}
}

func TestConditions(t *testing.T) {
	t.Parallel()
	s := signal.Signal{
		Provider: "OpenAI", HTTPStatus: 403, Status: "error",
		Attrs: map[string]string{"gen_ai.tool.name": "search", "user.id": "user-1", "gen_ai.request.temperature": "0.7", "gen_ai.prompt": "secret"},
	}
	cases := []struct {
		c    Condition
		want bool
	}{
		{Condition{Field: "provider", Op: "eq", Values: []string{"openai"}}, true},
		{Condition{Field: "provider", Op: "in", Values: []string{"anthropic", "openai"}}, true},
		{Condition{Field: "provider", Op: "not_in", Values: []string{"openai"}}, false},
		{Condition{Field: "http_status", Op: "in", Values: []string{"401", "403"}}, true},
		{Condition{Field: "http_status", Op: "gte", Values: []string{"400"}}, true},
		{Condition{Field: "model", Op: "not_in", Values: []string{"x"}}, false},
		{Condition{Field: "status", Op: "eq", Values: []string{"error"}}, true},
		{Condition{Field: "unknown", Op: "exists"}, false},
		{Condition{Field: "gen_ai.tool.name", Op: "eq", Values: []string{"search"}}, true},
		// user.id is opt-in personal data and not allowlisted by default.
		{Condition{Field: "user.id", Op: "eq", Values: []string{"user-1"}}, false},
		{Condition{Field: "gen_ai.request.temperature", Op: "gte", Values: []string{"0.5"}}, true},
		{Condition{Field: "gen_ai.prompt", Op: "contains", Values: []string{"secret"}}, false},
	}
	for _, tc := range cases {
		if got := tc.c.matches(s); got != tc.want {
			t.Fatalf("%+v = %v, want %v", tc.c, got, tc.want)
		}
	}
}

func TestEqWithSeveralValuesMeansOneOf(t *testing.T) {
	s := signal.Signal{Model: "gpt-4o-mini"}
	if !(Condition{Field: "model", Op: "eq", Values: []string{"gpt-4o", "gpt-4o-mini"}}).matches(s) {
		t.Fatal("eq should match any listed value")
	}
	if (Condition{Field: "model", Op: "neq", Values: []string{"gpt-4o", "gpt-4o-mini"}}).matches(s) {
		t.Fatal("neq should exclude every listed value")
	}
}
