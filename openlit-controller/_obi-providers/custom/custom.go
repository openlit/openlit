// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package ebpfcommon // import "go.opentelemetry.io/obi/pkg/ebpf/common/http"

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"go.opentelemetry.io/obi/pkg/appolly/app/request"
)

// customHostMatches reports whether a captured request's destination
// (host + port, as seen on the connection) matches one of the configured
// gateway specs. Each spec is "host:port" or bare "host" (any port). The
// captured host may be an IP or a DNS name depending on how the client dialed,
// so we match the spec host against both the connection Host and the HTTP
// Host header.
func customHostMatches(specs []string, connHost, headerHost string, port int) bool {
	connHost = strings.ToLower(strings.TrimSpace(connHost))
	headerHost = stripPort(strings.ToLower(strings.TrimSpace(headerHost)))

	for _, spec := range specs {
		spec = strings.ToLower(strings.TrimSpace(spec))
		if spec == "" {
			continue
		}
		specHost := spec
		specPort := ""
		if h, p, ok := splitHostPort(spec); ok {
			specHost, specPort = h, p
		}
		// Port must match when the spec pins one.
		if specPort != "" && specPort != strconv.Itoa(port) {
			continue
		}
		if specHost == "" {
			continue
		}
		if specHost == connHost || specHost == headerHost {
			return true
		}
	}
	return false
}

func splitHostPort(s string) (host, port string, ok bool) {
	i := strings.LastIndexByte(s, ':')
	if i < 0 {
		return s, "", false
	}
	// Avoid mistaking a bare IPv6 literal for host:port.
	if strings.IndexByte(s, ':') != i {
		return s, "", false
	}
	return s[:i], s[i+1:], true
}

func stripPort(s string) string {
	if h, _, ok := splitHostPort(s); ok {
		return h
	}
	return s
}

// --- GenAI semantic-conventions message normalization ---
//
// The semconv (github.com/open-telemetry/semantic-conventions-genai) defines a
// strict structure for gen_ai.input.messages, gen_ai.output.messages and
// gen_ai.system_instructions:
//
//	input/output messages: [{ "role": <role>, "parts": [ <part>, ... ],
//	                          "finish_reason": <reason>  // output only
//	                        }]
//	system_instructions:   [ <part>, ... ]   // a flat array of parts
//	part (text):           { "type": "text", "content": <string> }
//	part (tool_call):      { "type": "tool_call", "id": <id>, "name": <name>,
//	                          "arguments": <obj> }
//	part (tool_call_resp): { "type": "tool_call_response", "id": <id>,
//	                          "response": <any> }
//
// We map the OpenAI-compatible wire format (messages[].content, tool_calls,
// choices[].message) into this structure. Mirrors upstream OBI #2005.

type scPart struct {
	Type      string          `json:"type"`
	Content   string          `json:"content,omitempty"`
	ID        string          `json:"id,omitempty"`
	Name      string          `json:"name,omitempty"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
	Response  json.RawMessage `json:"response,omitempty"`
}

type scMessage struct {
	Role         string   `json:"role"`
	Parts        []scPart `json:"parts"`
	FinishReason string   `json:"finish_reason,omitempty"`
}

// openAIMessage mirrors one entry of the OpenAI chat `messages` array. content
// is either a plain string or an array of typed content parts.
type openAIMessage struct {
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content"`
	ToolCallID string          `json:"tool_call_id"`
	ToolCalls  []struct {
		ID       string `json:"id"`
		Function struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		} `json:"function"`
	} `json:"tool_calls"`
}

type openAIContentPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// contentToParts converts an OpenAI message `content` (string or parts array)
// into semconv text parts.
func contentToParts(raw json.RawMessage) []scPart {
	if len(raw) == 0 {
		return nil
	}
	// String content.
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		if s == "" {
			return nil
		}
		return []scPart{{Type: "text", Content: s}}
	}
	// Array of content parts (multimodal). Capture text parts; other modalities
	// are summarized as a generic text marker so the structure stays valid.
	var arr []openAIContentPart
	if err := json.Unmarshal(raw, &arr); err == nil {
		parts := make([]scPart, 0, len(arr))
		for _, p := range arr {
			switch p.Type {
			case "text", "input_text", "output_text", "":
				if p.Text != "" {
					parts = append(parts, scPart{Type: "text", Content: p.Text})
				}
			default:
				parts = append(parts, scPart{Type: "text", Content: "[" + p.Type + "]"})
			}
		}
		return parts
	}
	return nil
}

func messageToParts(m openAIMessage) []scPart {
	// A tool-result message ("role":"tool" with tool_call_id) carries the tool
	// response as its content.
	if m.ToolCallID != "" {
		return []scPart{{Type: "tool_call_response", ID: m.ToolCallID, Response: m.Content}}
	}
	parts := contentToParts(m.Content)
	for _, tc := range m.ToolCalls {
		parts = append(parts, scPart{
			Type:      "tool_call",
			ID:        tc.ID,
			Name:      tc.Function.Name,
			Arguments: tc.Function.Arguments,
		})
	}
	return parts
}

// normalizeInputMessages builds gen_ai.input.messages. System-role messages are
// excluded here (they belong in system_instructions). Falls back to wrapping a
// plain prompt/input string when the request used the completions/responses API.
func normalizeInputMessages(messages json.RawMessage, prompt, input string) string {
	var msgs []openAIMessage
	if len(messages) > 0 {
		_ = json.Unmarshal(messages, &msgs)
	}
	out := make([]scMessage, 0, len(msgs))
	for _, m := range msgs {
		if m.Role == "system" || m.Role == "developer" {
			continue
		}
		parts := messageToParts(m)
		if len(parts) == 0 {
			continue
		}
		out = append(out, scMessage{Role: m.Role, Parts: parts})
	}
	if len(out) == 0 {
		text := prompt
		if text == "" {
			text = input
		}
		if text == "" {
			return ""
		}
		out = append(out, scMessage{Role: "user", Parts: []scPart{{Type: "text", Content: text}}})
	}
	return marshalSC(out)
}

// openAIChoice mirrors one entry of a chat-completions `choices` array.
type openAIChoice struct {
	FinishReason string        `json:"finish_reason"`
	Message      openAIMessage `json:"message"`
	Text         string        `json:"text"` // legacy /completions
}

// normalizeOutputMessages builds gen_ai.output.messages from response choices.
func normalizeOutputMessages(choices json.RawMessage) string {
	if len(choices) == 0 {
		return ""
	}
	var arr []openAIChoice
	if err := json.Unmarshal(choices, &arr); err != nil {
		return ""
	}
	out := make([]scMessage, 0, len(arr))
	for _, c := range arr {
		role := c.Message.Role
		if role == "" {
			role = "assistant"
		}
		parts := messageToParts(c.Message)
		if len(parts) == 0 && c.Text != "" {
			parts = []scPart{{Type: "text", Content: c.Text}}
		}
		out = append(out, scMessage{Role: role, Parts: parts, FinishReason: c.FinishReason})
	}
	if len(out) == 0 {
		return ""
	}
	return marshalSC(out)
}

// normalizeSystemInstructions builds gen_ai.system_instructions: a flat array of
// parts, sourced from any system/developer-role messages plus the Responses API
// `instructions` field.
func normalizeSystemInstructions(messages json.RawMessage, instructions string) string {
	var parts []scPart
	if instructions != "" {
		parts = append(parts, scPart{Type: "text", Content: instructions})
	}
	if len(messages) > 0 {
		var msgs []openAIMessage
		if err := json.Unmarshal(messages, &msgs); err == nil {
			for _, m := range msgs {
				if m.Role == "system" || m.Role == "developer" {
					parts = append(parts, contentToParts(m.Content)...)
				}
			}
		}
	}
	if len(parts) == 0 {
		return ""
	}
	b, err := json.Marshal(parts)
	if err != nil {
		return ""
	}
	return string(b)
}

func marshalSC(msgs []scMessage) string {
	b, err := json.Marshal(msgs)
	if err != nil {
		return ""
	}
	return string(b)
}

// normalizeGenAIOperation maps raw OpenAI-compatible response "object" values to
// the GenAI semconv gen_ai.operation.name. Mirrors upstream OBI's normalization
// (PR #2005) so custom-gateway spans match the names used elsewhere on the
// platform (e.g. "chat", not "chat.completion").
func normalizeGenAIOperation(op string) string {
	switch op {
	case "chat.completion", "chat.completion.chunk":
		return "chat"
	case "text_completion":
		return "text_completion"
	case "list", "embedding":
		return "embeddings"
	default:
		return op
	}
}

// CustomSpan parses traffic to a configured custom OpenAI-compatible gateway
// (LiteLLM, vLLM, LocalAI, OpenRouter, ...). It is gated on the request's
// destination matching one of `hosts` (the dashboard's custom_llm_hosts), then
// parses the OpenAI-shaped request/response. Unlike OpenAISpan it does NOT
// require OpenAI-proprietary response headers, which self-hosted gateways do
// not emit. Returns ok=false when the destination is not a configured gateway
// or the body is not OpenAI-shaped.
func CustomSpan(baseSpan *request.Span, hosts []string, req *http.Request, resp *http.Response) (request.Span, bool) {
	if len(hosts) == 0 {
		return *baseSpan, false
	}

	headerHost := ""
	if req.URL != nil {
		headerHost = req.Host
	}
	if !customHostMatches(hosts, baseSpan.Host, headerHost, baseSpan.HostPort) {
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

	slog.Debug("Custom GenAI gateway", "request", string(reqB), "response", string(respB))

	var parsedRequest request.OpenAIInput
	if err := json.Unmarshal(reqB, &parsedRequest); err != nil {
		slog.Debug("failed to parse custom gateway request", "error", err)
	}

	var parsedResponse request.VendorOpenAI
	if err := json.Unmarshal(respB, &parsedResponse); err != nil {
		slog.Debug("failed to parse custom gateway response", "error", err)
	}

	parsedResponse.Request = parsedRequest

	// OperationName is parsed from the OpenAI-compatible response body's "object"
	// field (e.g. "chat.completion") via VendorOpenAI's struct tag — like the
	// OpenAI parser, and independent of the request path. A gateway serving chat
	// on a non-standard path (e.g. /testchat) is still named correctly as long as
	// the body is OpenAI-shaped.
	//
	// Fallback to a path hint only when the body carried no "object" (rare, e.g.
	// streamed responses); never used as a gate.
	if parsedResponse.OperationName == "" && req.URL != nil {
		p := strings.TrimSuffix(req.URL.Path, "/")
		switch {
		case strings.HasSuffix(p, "/embeddings"):
			parsedResponse.OperationName = "embeddings"
		case strings.HasSuffix(p, "/chat/completions"):
			parsedResponse.OperationName = "chat.completion"
		case strings.HasSuffix(p, "/completions"):
			parsedResponse.OperationName = "text_completion"
		}
	}
	// Normalize raw OpenAI object values to the GenAI semconv operation names
	// (gen_ai.operation.name), matching upstream OBI #2005: "chat.completion" -> "chat".
	parsedResponse.OperationName = normalizeGenAIOperation(parsedResponse.OperationName)

	baseSpan.SubType = request.HTTPSubtypeCustom
	baseSpan.GenAI = &request.GenAI{
		Custom: &parsedResponse,
		// Message bodies are normalized to the GenAI semantic-conventions
		// structure (role + parts[]), NOT emitted as the raw OpenAI shape.
		CustomInputMessages:      normalizeInputMessages(parsedRequest.Messages, parsedRequest.Prompt, parsedRequest.Input),
		CustomOutputMessages:     normalizeOutputMessages(parsedResponse.Choices),
		CustomSystemInstructions: normalizeSystemInstructions(parsedRequest.Messages, parsedRequest.Instructions),
	}

	return *baseSpan, true
}
