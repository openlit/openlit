// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package ebpfcommon // import "go.opentelemetry.io/obi/pkg/ebpf/common/http"

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"go.opentelemetry.io/obi/pkg/appolly/app/request"
)

// Ollama native API request/response schemas. These differ from the OpenAI
// wire format: tokens are prompt_eval_count/eval_count, chat output is in
// message.content, and /api/generate output is in response. The OpenAI-compat
// endpoint (/v1/...) is intentionally NOT handled here — it is covered by the
// OpenAI/custom extractor — so this parser path-gates on /api/chat and
// /api/generate only.

type ollamaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ollamaRequest struct {
	Model    string          `json:"model"`
	Messages []ollamaMessage `json:"messages"` // /api/chat
	Prompt   string          `json:"prompt"`   // /api/generate
}

type ollamaResponse struct {
	Model           string        `json:"model"`
	Message         ollamaMessage `json:"message"`  // /api/chat
	Response        string        `json:"response"` // /api/generate
	Done            bool          `json:"done"`
	PromptEvalCount int           `json:"prompt_eval_count"`
	EvalCount       int           `json:"eval_count"`
}

// OllamaSpan parses Ollama's native /api/chat and /api/generate traffic into a
// GenAI span. Returns ok=false for any other path or unparseable body.
func OllamaSpan(baseSpan *request.Span, req *http.Request, resp *http.Response) (request.Span, bool) {
	path := req.URL.Path
	var operation string
	switch {
	case strings.HasSuffix(path, "/api/chat"):
		operation = "chat"
	case strings.HasSuffix(path, "/api/generate"):
		operation = "generate"
	default:
		return *baseSpan, false
	}

	reqB, err := io.ReadAll(req.Body)
	if err != nil {
		return *baseSpan, false
	}
	req.Body = io.NopCloser(bytes.NewBuffer(reqB))

	respB, err := getResponseBody(resp)
	if err != nil && len(respB) == 0 {
		return *baseSpan, false
	}

	slog.Debug("Ollama", "request", string(reqB), "response", string(respB))

	var parsedReq ollamaRequest
	if err := json.Unmarshal(reqB, &parsedReq); err != nil {
		return *baseSpan, false
	}

	var parsedResp ollamaResponse
	// Response may be missing/streamed; tolerate parse failure and still emit
	// what we have from the request.
	_ = json.Unmarshal(respB, &parsedResp)

	model := parsedReq.Model
	if model == "" {
		model = parsedResp.Model
	}

	inputMessages := ""
	if len(parsedReq.Messages) > 0 {
		if b, mErr := json.Marshal(parsedReq.Messages); mErr == nil {
			inputMessages = string(b)
		}
	} else if parsedReq.Prompt != "" {
		inputMessages = parsedReq.Prompt
	}

	outputMessages := parsedResp.Message.Content
	if outputMessages == "" {
		outputMessages = parsedResp.Response
	}

	baseSpan.SubType = request.HTTPSubtypeOllama
	baseSpan.GenAI = &request.GenAI{
		Ollama: &request.VendorOllama{
			Model:        model,
			InputTokens:  parsedResp.PromptEvalCount,
			OutputTokens: parsedResp.EvalCount,
			Operation:    operation,
			Input:        inputMessages,
			Output:       outputMessages,
		},
	}

	return *baseSpan, true
}
