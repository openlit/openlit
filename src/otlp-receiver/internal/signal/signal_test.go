package signal

import (
	"testing"
	"time"

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
	if s.Attrs["gen_ai.request.temperature"] != "0.7" || s.Attrs["gen_ai.tool.name"] != "search" || s.Attrs["user.id"] != "user-1" {
		t.Fatalf("attributes = %+v", s.Attrs)
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
