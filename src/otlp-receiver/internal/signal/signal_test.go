package signal

import (
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/openlit/openlit/otlp-receiver/internal/otlpconv"
)

func TestSubject(t *testing.T) {
	t.Parallel()
	got, err := Subject(Tenant{OrganisationID: "org1", ProjectID: "proj_1", Environment: "prod.eu-west_1"})
	if err != nil {
		t.Fatal(err)
	}
	if want := "openlit.signal.org1.proj_1.prod_deu-west__1"; got != want {
		t.Fatalf("subject = %q, want %q", got, want)
	}
	bad := []Tenant{
		{OrganisationID: "org.1", ProjectID: "p", Environment: "e"},
		{OrganisationID: "org", ProjectID: "p>*", Environment: "e"},
		{OrganisationID: "org", ProjectID: "p", Environment: ""},
		{OrganisationID: "org", ProjectID: "p", Environment: "has space"},
		{OrganisationID: "", ProjectID: "p", Environment: "e"},
	}
	for _, tc := range bad {
		if _, err := Subject(tc); err == nil {
			t.Fatalf("expected rejection for %+v", tc)
		}
	}
}

func TestEnvTokenIsReversibleForDistinctNames(t *testing.T) {
	t.Parallel()
	if EnvToken("a.b") == EnvToken("a_b") {
		t.Fatal("dot and underscore must not collide")
	}
	if EnvToken("a_d") == EnvToken("a.") {
		t.Fatal("escaped forms must not collide")
	}
}

func TestFromTrace(t *testing.T) {
	t.Parallel()
	row := otlpconv.TraceRow{
		Timestamp:   time.Unix(100, 0),
		TraceID:     "t1",
		SpanID:      "s1",
		ServiceName: "svc",
		SpanName:    "chat gpt-4o",
		Duration:    1_500_000_000,
		StatusCode:  "STATUS_CODE_ERROR",
		SpanAttributes: map[string]string{
			"gen_ai.operation.name":      "chat",
			"gen_ai.system":              "openai",
			"gen_ai.request.model":       "gpt-4o",
			"gen_ai.usage.input_tokens":  "100",
			"gen_ai.usage.output_tokens": "50",
			"gen_ai.usage.cost":          "0.0123",
			"gen_ai.prompt":              "secret prompt",
			"gen_ai.request.temperature": "0.7",
			"gen_ai.tool.name":           "search",
			"http.response.status_code":  "429",
		},
		ResourceAttributes: map[string]string{
			"user.id":       "user-1",
			"gen_ai.prompt": "resource prompt",
		},
	}
	if !IsGenAI(row) {
		t.Fatal("expected genai")
	}
	s := FromTrace(row, Tenant{OrganisationID: "o", ProjectID: "p", Environment: "e", APIKeyID: "k"})
	if s.Provider != "openai" || s.Model != "gpt-4o" || s.Status != "error" || s.DurationMs != 1500 {
		t.Fatalf("unexpected %+v", s)
	}
	if s.TotalTokens != 150 || s.Cost == nil || *s.Cost != 0.0123 || s.HTTPStatus != 429 {
		t.Fatalf("unexpected usage %+v", s)
	}
	if s.Attrs["gen_ai.request.temperature"] != "0.7" || s.Attrs["gen_ai.tool.name"] != "search" {
		t.Fatalf("attributes = %+v", s.Attrs)
	}
	if _, ok := s.Attrs["user.id"]; ok {
		t.Fatal("user.id is opt-in and must not be copied by default")
	}
	if _, ok := s.Attrs["gen_ai.prompt"]; ok {
		t.Fatal("prompt text must not be copied")
	}
	if MsgID(s) != "t1:s1" {
		t.Fatal("msg id")
	}
	if IsGenAI(otlpconv.TraceRow{SpanAttributes: map[string]string{"http.method": "GET"}}) {
		t.Fatal("non genai span")
	}
}

func TestExtraAttributesIgnoreSensitiveKeys(t *testing.T) {
	SetExtraAttributes("app.tier, gen_ai.prompt, not a key")
	t.Cleanup(func() { SetExtraAttributes("") })
	s := FromTrace(otlpconv.TraceRow{SpanAttributes: map[string]string{
		"app.tier":      "gold",
		"gen_ai.prompt": "secret prompt",
	}}, Tenant{})
	if s.Attrs["app.tier"] != "gold" {
		t.Fatalf("extra attribute missing: %+v", s.Attrs)
	}
	if _, ok := s.Attrs["gen_ai.prompt"]; ok {
		t.Fatal("prompt text must stay off the signal")
	}
	if AllowedAttribute("not a key") {
		t.Fatal("invalid key was allowlisted")
	}
}

func TestOptInAttributesRequireConfiguration(t *testing.T) {
	row := otlpconv.TraceRow{SpanAttributes: map[string]string{
		"user.id": "user-1", "session.id": "s-1", "url.path": "/reset?token=abc", "server.address": "10.0.0.5",
	}}
	for _, key := range OptInAttributes {
		if AllowedAttribute(key) {
			t.Fatalf("%s must not be allowed by default", key)
		}
	}
	if s := FromTrace(row, Tenant{}); len(s.Attrs) != 0 {
		t.Fatalf("opt-in attributes copied by default: %+v", s.Attrs)
	}
	SetExtraAttributes("user.id")
	t.Cleanup(func() { SetExtraAttributes("") })
	s := FromTrace(row, Tenant{})
	if s.Attrs["user.id"] != "user-1" || len(s.Attrs) != 1 {
		t.Fatalf("opt-in attribute missing: %+v", s.Attrs)
	}
}

func TestCleanRedactsAndTruncates(t *testing.T) {
	t.Parallel()
	secrets := []string{
		"Bearer abcdefghijklmnop",
		"key sk-" + strings.Repeat("a1B2", 8),
		"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
		"AKIAIOSFODNN7EXAMPLE",
		"ghp_abcdefghijklmnopqrstuvwxyz0123456789",
		"openlit-0123456789abcdef0123",
		"https://x.test/cb?api_key=hunter22&x=1",
	}
	for _, v := range secrets {
		got := Clean(v)
		if !strings.Contains(got, redacted) {
			t.Fatalf("not redacted: %q -> %q", v, got)
		}
	}
	if Clean("gpt-4o-mini") != "gpt-4o-mini" || Clean("  search  ") != "search" {
		t.Fatal("ordinary values must pass through")
	}
	long := strings.Repeat("é", 300) // 2 bytes per rune
	got := Clean(long)
	if len(got) > MaxFieldBytes || !utf8.ValidString(got) {
		t.Fatalf("truncation broke utf-8 or limit: len=%d", len(got))
	}
}

func TestFromTraceBoundsEveryString(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("x", 5000)
	row := otlpconv.TraceRow{
		ServiceName: long, SpanName: long,
		SpanAttributes: map[string]string{
			"gen_ai.system": long, "gen_ai.request.model": long, "gen_ai.operation.name": long,
			"error.type": long, "gen_ai.tool.name": long,
		},
	}
	s := FromTrace(row, Tenant{})
	for name, v := range map[string]string{
		"service": s.Service, "span": s.SpanName, "provider": s.Provider, "model": s.Model,
		"operation": s.Operation, "error": s.ErrorType, "tool": s.Attrs["gen_ai.tool.name"],
	} {
		if len(v) > MaxFieldBytes {
			t.Fatalf("%s not truncated: %d", name, len(v))
		}
	}
}

func TestNormalizeEnvironment(t *testing.T) {
	t.Parallel()
	if env, ok := NormalizeEnvironment(" Production "); !ok || env != "production" {
		t.Fatalf("got %q %v", env, ok)
	}
	for _, bad := range []string{"", "has space", "-lead", strings.Repeat("a", 64)} {
		if _, ok := NormalizeEnvironment(bad); ok {
			t.Fatalf("expected %q rejected", bad)
		}
	}
}

func TestAnySafeAttributeIsForwarded(t *testing.T) {
	s := FromTrace(otlpconv.TraceRow{
		SpanAttributes: map[string]string{
			"app.tier":           "gold",
			"gen_ai.agent.name":  "planner",
			"gen_ai.prompt":      "secret prompt",
			"llm.content.output": "text",
			"user.email":         "a@b.c",
			"client.ip":          "10.0.0.1",
		},
		ResourceAttributes: map[string]string{"k8s.namespace.name": "prod", "app.tier": "silver"},
	}, Tenant{})
	if s.Attrs["app.tier"] != "gold" || s.Attrs["gen_ai.agent.name"] != "planner" || s.Attrs["k8s.namespace.name"] != "prod" {
		t.Fatalf("custom attributes missing: %+v", s.Attrs)
	}
	for _, key := range []string{"gen_ai.prompt", "llm.content.output", "user.email", "client.ip"} {
		if _, ok := s.Attrs[key]; ok {
			t.Fatalf("%s must not be forwarded by default", key)
		}
	}
}

func TestAttributesAreBounded(t *testing.T) {
	span := map[string]string{}
	for i := 0; i < 200; i++ {
		span[fmt.Sprintf("custom.attr%03d", i)] = strings.Repeat("x", 1000)
	}
	s := FromTrace(otlpconv.TraceRow{SpanAttributes: span}, Tenant{})
	if len(s.Attrs) != maxAttributes {
		t.Fatalf("attrs = %d, want %d", len(s.Attrs), maxAttributes)
	}
	for _, value := range s.Attrs {
		if len(value) > MaxFieldBytes {
			t.Fatalf("value not truncated: %d bytes", len(value))
		}
	}
}
