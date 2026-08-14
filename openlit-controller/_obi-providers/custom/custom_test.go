// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package ebpfcommon

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"go.opentelemetry.io/obi/pkg/appolly/app/request"
)

func customReqResp(path, host, reqBody, respBody string) (*http.Request, *http.Response) {
	req := &http.Request{
		Method: "POST",
		URL:    &url.URL{Path: path},
		Host:   host,
		Body:   io.NopCloser(strings.NewReader(reqBody)),
		Header: http.Header{},
	}
	resp := &http.Response{
		StatusCode: 200,
		Body:       io.NopCloser(strings.NewReader(respBody)),
		Header:     http.Header{},
	}
	return req, resp
}

const openAIShapedResp = `{"object":"chat.completion","id":"cmpl-1","model":"gpt-4o-mini","choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"hi"}}],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}`
const openAIShapedReq = `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"temperature":0.7}`

// Matches a configured gateway by host:port -> parsed as custom GenAI span.
func TestCustomSpanHostMatch(t *testing.T) {
	base := &request.Span{Type: request.EventTypeHTTPClient, Host: "172.24.0.3", HostPort: 4000}
	req, resp := customReqResp("/chat/completions", "litellm:4000", openAIShapedReq, openAIShapedResp)
	req.Body = io.NopCloser(bytes.NewBufferString(openAIShapedReq))

	span, ok := CustomSpan(base, []string{"litellm:4000"}, req, resp)
	if !ok {
		t.Fatal("expected CustomSpan to match configured gateway litellm:4000")
	}
	if span.SubType != request.HTTPSubtypeCustom {
		t.Fatalf("expected HTTPSubtypeCustom, got %d", span.SubType)
	}
	if span.GenAI == nil || span.GenAI.Custom == nil {
		t.Fatal("expected GenAI.Custom populated")
	}
	if span.GenAI.Custom.Request.Model != "gpt-4o-mini" {
		t.Fatalf("model: %q", span.GenAI.Custom.Request.Model)
	}
	if span.GenAI.Custom.Usage.GetInputTokens() != 11 || span.GenAI.Custom.Usage.GetOutputTokens() != 7 {
		t.Fatalf("tokens wrong: %+v", span.GenAI.Custom.Usage)
	}
	// Operation normalized to semconv ("chat.completion" -> "chat").
	if span.GenAI.Custom.OperationName != "chat" {
		t.Fatalf("operation should normalize to 'chat', got %q", span.GenAI.Custom.OperationName)
	}
	// Span name follows the OpenAI convention "<operation> <model>".
	if name := span.TraceName(); name != "chat gpt-4o-mini" {
		t.Fatalf("span name: got %q, want %q", name, "chat gpt-4o-mini")
	}

	// Messages MUST follow the GenAI semconv structure (role + parts[]), not the
	// raw OpenAI shape.
	var inMsgs []scMessage
	if err := json.Unmarshal([]byte(span.GenAI.CustomInputMessages), &inMsgs); err != nil {
		t.Fatalf("input messages not valid JSON: %v (%s)", err, span.GenAI.CustomInputMessages)
	}
	if len(inMsgs) != 1 || inMsgs[0].Role != "user" || len(inMsgs[0].Parts) != 1 ||
		inMsgs[0].Parts[0].Type != "text" || inMsgs[0].Parts[0].Content != "hi" {
		t.Fatalf("input messages not semconv-shaped: %s", span.GenAI.CustomInputMessages)
	}

	var outMsgs []scMessage
	if err := json.Unmarshal([]byte(span.GenAI.CustomOutputMessages), &outMsgs); err != nil {
		t.Fatalf("output messages not valid JSON: %v (%s)", err, span.GenAI.CustomOutputMessages)
	}
	if len(outMsgs) != 1 || outMsgs[0].Role != "assistant" || outMsgs[0].FinishReason != "stop" ||
		len(outMsgs[0].Parts) != 1 || outMsgs[0].Parts[0].Type != "text" {
		t.Fatalf("output messages not semconv-shaped (need role+parts+finish_reason): %s", span.GenAI.CustomOutputMessages)
	}
}

// System and developer role messages become system_instructions (a flat parts
// array), tool calls/results become tool_call / tool_call_response parts.
func TestCustomSpanSemconvSystemAndTools(t *testing.T) {
	base := &request.Span{Type: request.EventTypeHTTPClient, Host: "litellm", HostPort: 4000}
	reqBody := `{"model":"gpt-4o-mini","messages":[` +
		`{"role":"system","content":"be brief"},` +
		`{"role":"user","content":"weather?"},` +
		`{"role":"assistant","tool_calls":[{"id":"call_1","function":{"name":"get_weather","arguments":"{\"city\":\"SF\"}"}}]},` +
		`{"role":"tool","tool_call_id":"call_1","content":"sunny"}` +
		`]}`
	respBody := `{"object":"chat.completion","model":"gpt-4o-mini","choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"It's sunny."}}],"usage":{"prompt_tokens":5,"completion_tokens":3}}`
	req, resp := customReqResp("/chat/completions", "litellm:4000", reqBody, respBody)
	req.Body = io.NopCloser(bytes.NewBufferString(reqBody))

	span, ok := CustomSpan(base, []string{"litellm:4000"}, req, resp)
	if !ok {
		t.Fatal("expected match")
	}

	// system_instructions: flat parts array with the system content.
	var sys []scPart
	if err := json.Unmarshal([]byte(span.GenAI.CustomSystemInstructions), &sys); err != nil {
		t.Fatalf("system_instructions not valid JSON: %v (%s)", err, span.GenAI.CustomSystemInstructions)
	}
	if len(sys) != 1 || sys[0].Type != "text" || sys[0].Content != "be brief" {
		t.Fatalf("system_instructions wrong: %s", span.GenAI.CustomSystemInstructions)
	}

	// input messages: system excluded; tool_call and tool_call_response parts present.
	var in []scMessage
	if err := json.Unmarshal([]byte(span.GenAI.CustomInputMessages), &in); err != nil {
		t.Fatalf("bad input json: %v", err)
	}
	var sawToolCall, sawToolResp, sawSystem bool
	for _, m := range in {
		if m.Role == "system" {
			sawSystem = true
		}
		for _, p := range m.Parts {
			switch p.Type {
			case "tool_call":
				if p.Name == "get_weather" && p.ID == "call_1" {
					sawToolCall = true
				}
			case "tool_call_response":
				if p.ID == "call_1" {
					sawToolResp = true
				}
			}
		}
	}
	if sawSystem {
		t.Fatal("system message must NOT appear in input.messages")
	}
	if !sawToolCall {
		t.Fatalf("expected tool_call part: %s", span.GenAI.CustomInputMessages)
	}
	if !sawToolResp {
		t.Fatalf("expected tool_call_response part: %s", span.GenAI.CustomInputMessages)
	}
}

// A custom gateway serving chat on a NON-standard path is still named correctly,
// because the operation comes from the response body's "object", not the path.
func TestCustomSpanNonStandardPath(t *testing.T) {
	base := &request.Span{Type: request.EventTypeHTTPClient, Host: "myproxy", HostPort: 9000}
	req, resp := customReqResp("/testchat", "myproxy:9000", openAIShapedReq, openAIShapedResp)
	req.Body = io.NopCloser(bytes.NewBufferString(openAIShapedReq))

	span, ok := CustomSpan(base, []string{"myproxy:9000"}, req, resp)
	if !ok {
		t.Fatal("expected match on non-standard path /testchat")
	}
	if span.GenAI.Custom.OperationName != "chat" {
		t.Fatalf("operation should be 'chat' from body object, got %q", span.GenAI.Custom.OperationName)
	}
	if name := span.TraceName(); name != "chat gpt-4o-mini" {
		t.Fatalf("span name: got %q", name)
	}
}

// A request to a host NOT in the configured set must be ignored.
func TestCustomSpanHostNoMatch(t *testing.T) {
	base := &request.Span{Host: "10.0.0.9", HostPort: 9999}
	req, resp := customReqResp("/chat/completions", "other.svc:9999", openAIShapedReq, openAIShapedResp)
	req.Body = io.NopCloser(bytes.NewBufferString(openAIShapedReq))

	if _, ok := CustomSpan(base, []string{"litellm:4000"}, req, resp); ok {
		t.Fatal("must NOT match a host outside custom_llm_hosts")
	}
}

// Right host but wrong port (spec pins a port) must be ignored.
func TestCustomSpanPortMismatch(t *testing.T) {
	base := &request.Span{Host: "litellm", HostPort: 8080}
	req, resp := customReqResp("/chat/completions", "litellm:8080", openAIShapedReq, openAIShapedResp)
	req.Body = io.NopCloser(bytes.NewBufferString(openAIShapedReq))

	if _, ok := CustomSpan(base, []string{"litellm:4000"}, req, resp); ok {
		t.Fatal("must NOT match when spec pins port 4000 but conn is :8080")
	}
}

// Bare host spec (no port) matches any port.
func TestCustomSpanBareHostAnyPort(t *testing.T) {
	base := &request.Span{Host: "gw", HostPort: 12345}
	req, resp := customReqResp("/v1/chat/completions", "gw:12345", openAIShapedReq, openAIShapedResp)
	req.Body = io.NopCloser(bytes.NewBufferString(openAIShapedReq))

	if _, ok := CustomSpan(base, []string{"gw"}, req, resp); !ok {
		t.Fatal("bare host spec should match any port")
	}
}

// Matched host but non-OpenAI-shaped body still yields no GenAI fields, but the
// parser is tolerant: with no model/usage it should still not panic. We assert
// it returns ok (host matched) but Custom has empty model.
func TestCustomSpanEmptyHosts(t *testing.T) {
	base := &request.Span{Host: "litellm", HostPort: 4000}
	req, resp := customReqResp("/chat/completions", "litellm:4000", openAIShapedReq, openAIShapedResp)
	if _, ok := CustomSpan(base, nil, req, resp); ok {
		t.Fatal("no configured hosts -> never matches")
	}
}
