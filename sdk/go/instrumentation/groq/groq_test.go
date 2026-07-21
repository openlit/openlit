package groq

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	openlit "github.com/openlit/openlit/sdk/go"
	"github.com/openlit/openlit/sdk/go/helpers"
	"github.com/openlit/openlit/sdk/go/semconv"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// initSDK initialises OpenLIT with all exporters disabled and registers cleanup.
func initSDK(t *testing.T) {
	t.Helper()
	if err := openlit.Init(openlit.Config{
		OtlpEndpoint:        "http://localhost:4318",
		Environment:         "test",
		ApplicationName:     "go-sdk-groq-unit-tests",
		DisableTracing:      true,
		DisableMetrics:      true,
		DisableBatch:        true,
		DisablePricingFetch: true,
	}); err != nil {
		t.Fatalf("openlit.Init: %v", err)
	}
	t.Cleanup(func() { openlit.Shutdown(context.Background()) }) //nolint:errcheck
}

// ---------------------------------------------------------------------------
// Chat completion — success paths
// ---------------------------------------------------------------------------

func TestChatCompletion(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("unexpected method: %s", r.Method)
		}

		resp := ChatCompletionResponse{
			ID:     "chatcmpl-groq-001",
			Object: "chat.completion",
			Model:  "llama3-8b-8192",
			Choices: []ChatCompletionChoice{
				{
					Index:        0,
					Message:      ChatMessage{Role: "assistant", Content: "Hello from Groq!"},
					FinishReason: "stop",
				},
			},
			Usage: &Usage{PromptTokens: 8, CompletionTokens: 6, TotalTokens: 14},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	// vLLM does not require an API key for local deployments
	client := NewClient(srv.URL)

	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:    "llama3-8b-8192",
		Messages: []ChatMessage{{Role: "user", Content: "Hello"}},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if resp.ID != "chatcmpl-groq-001" {
		t.Errorf("want ID chatcmpl-groq-001, got %s", resp.ID)
	}
	if len(resp.Choices) != 1 {
		t.Fatalf("want 1 choice, got %d", len(resp.Choices))
	}
	if resp.Choices[0].Message.Content != "Hello from Groq!" {
		t.Errorf("unexpected content: %s", resp.Choices[0].Message.Content)
	}
	if resp.Choices[0].FinishReason != "stop" {
		t.Errorf("want finish_reason=stop, got %s", resp.Choices[0].FinishReason)
	}
	if resp.Usage.PromptTokens != 8 {
		t.Errorf("want 8 prompt tokens, got %d", resp.Usage.PromptTokens)
	}
	if resp.Usage.CompletionTokens != 6 {
		t.Errorf("want 6 completion tokens, got %d", resp.Usage.CompletionTokens)
	}
	if resp.Usage.TotalTokens != 14 {
		t.Errorf("want 14 total tokens, got %d", resp.Usage.TotalTokens)
	}
}

func TestChatCompletion_WithParams(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode body: %v", err)
		}
		if req.Temperature != 0.7 {
			t.Errorf("want temperature=0.7, got %v", req.Temperature)
		}
		if req.MaxTokens != 100 {
			t.Errorf("want max_tokens=100, got %d", req.MaxTokens)
		}
		if req.TopP != 0.9 {
			t.Errorf("want top_p=0.9, got %v", req.TopP)
		}
		if req.TopK != 40 {
			t.Errorf("want top_k=40, got %d", req.TopK)
		}

		resp := ChatCompletionResponse{
			ID:    "chatcmpl-groq-002",
			Model: "meta-llama/Llama-3-8b-hf",
			Choices: []ChatCompletionChoice{
				{Message: ChatMessage{Role: "assistant", Content: "OK!"}, FinishReason: "stop"},
			},
			Usage: &Usage{PromptTokens: 10, CompletionTokens: 2, TotalTokens: 12},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient(srv.URL)

	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:       "meta-llama/Llama-3-8b-hf",
		Messages:    []ChatMessage{{Role: "user", Content: "Help"}},
		Temperature: 0.7,
		MaxTokens:   100,
		TopP:        0.9,
		TopK:        40,
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if resp.ID != "chatcmpl-groq-002" {
		t.Errorf("want ID chatcmpl-groq-002, got %s", resp.ID)
	}
}

func TestChatCompletion_WithSystemMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req ChatCompletionRequest
		json.NewDecoder(r.Body).Decode(&req) //nolint:errcheck
		if len(req.Messages) != 2 {
			t.Errorf("want 2 messages (system+user), got %d", len(req.Messages))
		}
		if req.Messages[0].Role != "system" {
			t.Errorf("want first message role=system, got %s", req.Messages[0].Role)
		}

		resp := ChatCompletionResponse{
			ID:    "chatcmpl-groq-sys",
			Model: "llama3-8b-8192",
			Choices: []ChatCompletionChoice{
				{Message: ChatMessage{Role: "assistant", Content: "15"}, FinishReason: "stop"},
			},
			Usage: &Usage{PromptTokens: 15, CompletionTokens: 1, TotalTokens: 16},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient(srv.URL, WithAPIKey("test-key"))

	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model: "llama3-8b-8192",
		Messages: []ChatMessage{
			{Role: "system", Content: "You are a calculator. Reply only with the numeric result."},
			{Role: "user", Content: "What is 7 + 8?"},
		},
		Temperature: 0,
		MaxTokens:   10,
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if resp.Choices[0].Message.Content != "15" {
		t.Errorf("want answer=15, got %s", resp.Choices[0].Message.Content)
	}
}

func TestChatCompletion_MultiTurn(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req ChatCompletionRequest
		json.NewDecoder(r.Body).Decode(&req) //nolint:errcheck
		if len(req.Messages) != 3 {
			t.Errorf("want 3 messages, got %d", len(req.Messages))
		}
		if req.Messages[1].Role != "assistant" {
			t.Errorf("want messages[1].role=assistant, got %s", req.Messages[1].Role)
		}

		resp := ChatCompletionResponse{
			ID:    "chatcmpl-groq-003",
			Model: "llama3-8b-8192",
			Choices: []ChatCompletionChoice{
				{Message: ChatMessage{Role: "assistant", Content: "Follow-up answer"}, FinishReason: "stop"},
			},
			Usage: &Usage{PromptTokens: 20, CompletionTokens: 5, TotalTokens: 25},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient(srv.URL)

	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model: "llama3-8b-8192",
		Messages: []ChatMessage{
			{Role: "user", Content: "First question"},
			{Role: "assistant", Content: "First answer"},
			{Role: "user", Content: "Follow-up question"},
		},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if resp.Choices[0].Message.Content != "Follow-up answer" {
		t.Errorf("unexpected content: %s", resp.Choices[0].Message.Content)
	}
}

func TestChatCompletion_WithTools(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req ChatCompletionRequest
		json.NewDecoder(r.Body).Decode(&req) //nolint:errcheck
		if len(req.Tools) != 1 {
			t.Errorf("want 1 tool, got %d", len(req.Tools))
		}
		if req.Tools[0].Function.Name != "get_weather" {
			t.Errorf("unexpected tool name: %s", req.Tools[0].Function.Name)
		}

		resp := ChatCompletionResponse{
			ID:    "chatcmpl-vllm-004",
			Model: "llama3-8b-8192",
			Choices: []ChatCompletionChoice{
				{
					Message: ChatMessage{
						Role:    "assistant",
						Content: "",
						ToolCalls: []ToolCall{
							{
								ID:   "call_vllm_abc",
								Type: "function",
								Function: struct {
									Name      string `json:"name"`
									Arguments string `json:"arguments"`
								}{
									Name:      "get_weather",
									Arguments: `{"location":"San Francisco"}`,
								},
							},
						},
					},
					FinishReason: "tool_calls",
				},
			},
			Usage: &Usage{PromptTokens: 30, CompletionTokens: 15, TotalTokens: 45},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient(srv.URL)

	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:    "llama3-8b-8192",
		Messages: []ChatMessage{{Role: "user", Content: "What's the weather in SF?"}},
		Tools: []Tool{
			{
				Type: "function",
				Function: Function{
					Name:        "get_weather",
					Description: "Get current weather",
					Parameters: map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"location": map[string]interface{}{"type": "string"},
						},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if resp.Choices[0].FinishReason != "tool_calls" {
		t.Errorf("want finish_reason=tool_calls, got %s", resp.Choices[0].FinishReason)
	}
	if len(resp.Choices[0].Message.ToolCalls) != 1 {
		t.Fatalf("want 1 tool call, got %d", len(resp.Choices[0].Message.ToolCalls))
	}
	if resp.Choices[0].Message.ToolCalls[0].Function.Name != "get_weather" {
		t.Errorf("unexpected tool name: %s", resp.Choices[0].Message.ToolCalls[0].Function.Name)
	}
}

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

func TestChatCompletion_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprint(w, `{"error":{"message":"Internal server error"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient(srv.URL)

	_, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:    "llama3-8b-8192",
		Messages: []ChatMessage{{Role: "user", Content: "Hello"}},
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("expected 500 in error, got: %v", err)
	}
}

func TestChatCompletion_ModelNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprint(w, `{"error":{"message":"Model not found"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient(srv.URL)

	_, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:    "nonexistent/model",
		Messages: []ChatMessage{{Role: "user", Content: "Hello"}},
	})
	if err == nil {
		t.Fatal("expected error for missing model, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("expected 404 in error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Default client configuration
// ---------------------------------------------------------------------------

func TestNewClient_DefaultBaseURL(t *testing.T) {
	client := NewClient("")
	if client.baseURL != "https://api.groq.com/v1" {
		t.Errorf("want default baseURL http://127.0.0.1:8000/v1, got %s", client.baseURL)
	}
}

func TestNewClient_WithAPIKey(t *testing.T) {
	client := NewClient("http://localhost:8000/v1", WithAPIKey("test-key"))
	if client.apiKey != "test-key" {
		t.Errorf("want apiKey=test-key, got %s", client.apiKey)
	}
}

func TestNewClient_APIKeyRequired(t *testing.T) {
	client := NewClient("https://api.groq.com/v1", WithAPIKey("test-groq-key"))
	if client.apiKey != "test-groq-key" {
		t.Errorf("want apiKey=test-groq-key, got %s", client.apiKey)
	}
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

func TestChatCompletion_Streaming(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)

		chunks := []string{
			`{"id":"cmpl-vllm-s1","object":"chat.completion.chunk","model":"llama3-8b-8192","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}`,
			`{"id":"cmpl-vllm-s1","object":"chat.completion.chunk","model":"llama3-8b-8192","choices":[{"index":0,"delta":{"content":" from"},"finish_reason":null}]}`,
			`{"id":"cmpl-vllm-s1","object":"chat.completion.chunk","model":"llama3-8b-8192","choices":[{"index":0,"delta":{"content":" Groq"},"finish_reason":null}]}`,
			`{"id":"cmpl-vllm-s1","object":"chat.completion.chunk","model":"llama3-8b-8192","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}`,
		}
		for _, c := range chunks {
			fmt.Fprintf(w, "data: %s\n\n", c)
			w.(http.Flusher).Flush()
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
		w.(http.Flusher).Flush()
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient(srv.URL)

	stream, err := client.CreateChatCompletionStream(context.Background(), ChatCompletionRequest{
		Model:    "llama3-8b-8192",
		Messages: []ChatMessage{{Role: "user", Content: "Hi"}},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletionStream: %v", err)
	}
	defer stream.Close() //nolint:errcheck

	accumulated := ""
	chunkCount := 0
	for {
		chunk, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("stream.Recv: %v", err)
		}
		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			accumulated += chunk.Choices[0].Delta.Content
			chunkCount++
		}
	}

	if chunkCount == 0 {
		t.Error("expected at least one content chunk")
	}
	if accumulated != "Hello from Groq" {
		t.Errorf("want accumulated content %q, got %q", "Hello from Groq", accumulated)
	}
}

func TestChatCompletion_Streaming_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, `{"error":{"message":"Groq server unavailable"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient(srv.URL)

	_, err := client.CreateChatCompletionStream(context.Background(), ChatCompletionRequest{
		Model:    "llama3-8b-8192",
		Messages: []ChatMessage{{Role: "user", Content: "Hi"}},
	})
	if err == nil {
		t.Fatal("expected error for unavailable server, got nil")
	}
	if !strings.Contains(err.Error(), "503") {
		t.Errorf("expected 503 in error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Telemetry attribute / span assertions
// ---------------------------------------------------------------------------

func setupSpanRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	otel.SetTracerProvider(tp)
	helpers.SetCaptureMessageContent(true)
	t.Cleanup(func() {
		_ = tp.Shutdown(context.Background())
		otel.SetTracerProvider(sdktrace.NewTracerProvider())
		helpers.SetCaptureMessageContent(true)
	})
	return sr
}

func attrString(span sdktrace.ReadOnlySpan, key string) string {
	for _, a := range span.Attributes() {
		if string(a.Key) == key {
			return a.Value.AsString()
		}
	}
	return ""
}

func attrInt(span sdktrace.ReadOnlySpan, key string) int64 {
	for _, a := range span.Attributes() {
		if string(a.Key) == key {
			return a.Value.AsInt64()
		}
	}
	return 0
}

func attrFloat(span sdktrace.ReadOnlySpan, key string) float64 {
	for _, a := range span.Attributes() {
		if string(a.Key) == key {
			return a.Value.AsFloat64()
		}
	}
	return 0
}

func hasEvent(span sdktrace.ReadOnlySpan, name string) bool {
	for _, e := range span.Events() {
		if e.Name == name {
			return true
		}
	}
	return false
}

func TestChatCompletion_TelemetryAttributes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := ChatCompletionResponse{
			ID:    "chatcmpl-telem-1",
			Model: "llama3-8b-8192",
			Choices: []ChatCompletionChoice{
				{Message: ChatMessage{Role: "assistant", Content: "hi"}, FinishReason: "stop"},
			},
			Usage: &Usage{PromptTokens: 3, CompletionTokens: 1, TotalTokens: 4},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	sr := setupSpanRecorder(t)
	client := NewClient(srv.URL)

	_, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:       "llama3-8b-8192",
		Messages:    []ChatMessage{{Role: "user", Content: "Hello"}},
		Temperature: 0.5,
		TopK:        20,
		Tools: []Tool{{
			Type: "function",
			Function: Function{
				Name:        "get_weather",
				Description: "Get weather",
				Parameters:  map[string]interface{}{"type": "object"},
			},
		}},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}

	spans := sr.Ended()
	if len(spans) != 1 {
		t.Fatalf("want 1 span, got %d", len(spans))
	}
	span := spans[0]

	if span.Name() != "chat llama3-8b-8192" {
		t.Errorf("want span name chat llama3-8b-8192, got %s", span.Name())
	}
	if got := attrString(span, semconv.GenAISystem); got != semconv.GenAISystemGroq {
		t.Errorf("gen_ai.system: want %s, got %s", semconv.GenAISystemGroq, got)
	}
	if got := attrString(span, semconv.GenAIProviderName); got != semconv.GenAISystemGroq {
		t.Errorf("gen_ai.provider.name: want %s, got %s", semconv.GenAISystemGroq, got)
	}
	if got := attrString(span, semconv.GenAIResponseID); got != "chatcmpl-telem-1" {
		t.Errorf("response id: want chatcmpl-telem-1, got %s", got)
	}
	if got := attrInt(span, semconv.GenAIUsageInputTokens); got != 3 {
		t.Errorf("input tokens: want 3, got %d", got)
	}
	if got := attrInt(span, semconv.GenAIRequestTopK); got != 20 {
		t.Errorf("top_k: want 20, got %d", got)
	}
	if got := attrFloat(span, semconv.GenAIRequestTemperature); got != 0.5 {
		t.Errorf("temperature: want 0.5, got %v", got)
	}
	if got := attrString(span, semconv.GenAIInputMessages); got == "" {
		t.Error("expected gen_ai.input.messages to be set")
	}
	if got := attrString(span, semconv.GenAIOutputMessages); got == "" {
		t.Error("expected gen_ai.output.messages to be set")
	}
	if got := attrString(span, semconv.GenAIToolDefinitions); got == "" || !strings.Contains(got, "get_weather") {
		t.Errorf("expected tool definitions containing get_weather, got %q", got)
	}
	if got := attrString(span, semconv.OpenLITSDKVersion); got == "" {
		t.Error("expected openlit.sdk.version to be set")
	}
	if !hasEvent(span, semconv.GenAIClientInferenceOperationDetails) {
		t.Error("expected inference operation details event")
	}

	// server.address/port must come from the httptest baseURL, not hard-coded 8000
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parse srv.URL: %v", err)
	}
	if got := attrString(span, semconv.ServerAddress); got != u.Hostname() {
		t.Errorf("server.address: want %s, got %s", u.Hostname(), got)
	}
	wantPort, _ := strconv.Atoi(u.Port())
	if got := attrInt(span, semconv.ServerPort); got != int64(wantPort) {
		t.Errorf("server.port: want %d, got %d", wantPort, got)
	}
}

func TestChatCompletion_TelemetryCustomBaseURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		resp := ChatCompletionResponse{
			ID:    "chatcmpl-url",
			Model: "m",
			Choices: []ChatCompletionChoice{
				{Message: ChatMessage{Role: "assistant", Content: "ok"}, FinishReason: "stop"},
			},
			Usage: &Usage{PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	sr := setupSpanRecorder(t)
	client := NewClient(srv.URL + "/v1")

	if _, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:    "m",
		Messages: []ChatMessage{{Role: "user", Content: "x"}},
	}); err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}

	spans := sr.Ended()
	if len(spans) != 1 {
		t.Fatalf("want 1 span, got %d", len(spans))
	}
	u, _ := url.Parse(srv.URL)
	span := spans[0]
	if got := attrString(span, semconv.ServerAddress); got != u.Hostname() {
		t.Errorf("server.address: want %s, got %s", u.Hostname(), got)
	}
	wantPort, _ := strconv.Atoi(u.Port())
	if got := attrInt(span, semconv.ServerPort); got != int64(wantPort) {
		t.Errorf("server.port: want %d, got %d", wantPort, got)
	}
}

func TestChatCompletion_StreamingOutputMessages(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "data: {\"id\":\"s1\",\"model\":\"llama3-8b-8192\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hi\"},\"finish_reason\":null}]}\n\n")
		fmt.Fprintf(w, "data: {\"id\":\"s1\",\"model\":\"llama3-8b-8192\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"!\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
		w.(http.Flusher).Flush()
	}))
	defer srv.Close()

	sr := setupSpanRecorder(t)
	client := NewClient(srv.URL)
	stream, err := client.CreateChatCompletionStream(context.Background(), ChatCompletionRequest{
		Model:    "llama3-8b-8192",
		Messages: []ChatMessage{{Role: "user", Content: "Hi"}},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletionStream: %v", err)
	}
	for {
		_, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("Recv: %v", err)
		}
	}
	_ = stream.Close()

	// Allow readStream goroutine to finish
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(sr.Ended()) >= 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	spans := sr.Ended()
	if len(spans) != 1 {
		t.Fatalf("want 1 span, got %d", len(spans))
	}
	span := spans[0]
	out := attrString(span, semconv.GenAIOutputMessages)
	if out == "" || !strings.Contains(out, "Hi!") {
		t.Errorf("expected gen_ai.output.messages with Hi!, got %q", out)
	}
	if attrString(span, semconv.GenAICompletion) != "" {
		t.Error("streaming should not set legacy gen_ai.completion when using output.messages")
	}
	if !hasEvent(span, semconv.GenAIClientInferenceOperationDetails) {
		t.Error("expected inference event on streaming span")
	}
	if attrFloat(span, semconv.GenAIServerTimeToFirstToken) <= 0 {
		t.Error("expected TTFT > 0 on streaming span")
	}
}
