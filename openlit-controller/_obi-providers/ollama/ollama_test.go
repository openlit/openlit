// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package ebpfcommon

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"go.opentelemetry.io/obi/pkg/appolly/app/request"
)

func makeOllamaReqResp(path, reqBody, respBody string) (*http.Request, *http.Response) {
	req := &http.Request{
		Method: "POST",
		URL:    &url.URL{Path: path},
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

func TestOllamaSpanChat(t *testing.T) {
	reqBody := `{"model":"llama3.2","messages":[{"role":"user","content":"hello"}]}`
	respBody := `{"model":"llama3.2","message":{"role":"assistant","content":"hi there"},"done":true,"prompt_eval_count":11,"eval_count":7}`

	base := &request.Span{}
	req, resp := makeOllamaReqResp("/api/chat", reqBody, respBody)
	// reset body since OllamaSpan reads it
	req.Body = io.NopCloser(bytes.NewBufferString(reqBody))

	span, ok := OllamaSpan(base, req, resp)
	if !ok {
		t.Fatal("expected OllamaSpan to match /api/chat")
	}
	if span.GenAI == nil || span.GenAI.Ollama == nil {
		t.Fatal("expected GenAI.Ollama populated")
	}
	o := span.GenAI.Ollama
	if o.Model != "llama3.2" {
		t.Fatalf("model: got %q", o.Model)
	}
	if o.InputTokens != 11 || o.OutputTokens != 7 {
		t.Fatalf("tokens: in=%d out=%d", o.InputTokens, o.OutputTokens)
	}
	if !strings.Contains(o.Output, "hi there") {
		t.Fatalf("output content missing: %q", o.Output)
	}
	if o.Operation != "chat" {
		t.Fatalf("operation: got %q", o.Operation)
	}
}

func TestOllamaSpanGenerate(t *testing.T) {
	reqBody := `{"model":"llama3.2","prompt":"why is the sky blue?"}`
	respBody := `{"model":"llama3.2","response":"because of rayleigh scattering","done":true,"prompt_eval_count":5,"eval_count":9}`

	base := &request.Span{}
	req, resp := makeOllamaReqResp("/api/generate", reqBody, respBody)
	req.Body = io.NopCloser(bytes.NewBufferString(reqBody))

	span, ok := OllamaSpan(base, req, resp)
	if !ok {
		t.Fatal("expected OllamaSpan to match /api/generate")
	}
	o := span.GenAI.Ollama
	if o.OutputTokens != 9 || !strings.Contains(o.Output, "rayleigh") {
		t.Fatalf("unexpected generate parse: %+v", o)
	}
	if o.Operation != "generate" {
		t.Fatalf("operation: got %q", o.Operation)
	}
}

func TestOllamaSpanIgnoresOpenAIPath(t *testing.T) {
	base := &request.Span{}
	req, resp := makeOllamaReqResp("/v1/chat/completions", `{"model":"x"}`, `{}`)
	req.Body = io.NopCloser(bytes.NewBufferString(`{"model":"x"}`))

	if _, ok := OllamaSpan(base, req, resp); ok {
		t.Fatal("OllamaSpan must NOT match the /v1/ OpenAI-compat path")
	}
}
