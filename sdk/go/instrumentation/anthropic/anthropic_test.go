package anthropic

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	openlit "github.com/openlit/openlit/sdk/go"
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
		ApplicationName:     "go-sdk-unit-tests",
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
// Messages API — success paths
// ---------------------------------------------------------------------------

func TestCreateMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/messages" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("unexpected method: %s", r.Method)
		}
		if r.Header.Get("x-api-key") == "" {
			t.Error("missing x-api-key header")
		}
		if r.Header.Get("anthropic-version") == "" {
			t.Error("missing anthropic-version header")
		}

		resp := MessageResponse{
			ID:   "msg-001",
			Type: "message",
			Role: "assistant",
			Content: []ContentBlock{
				{Type: "text", Text: "Hello! I'm Claude."},
			},
			Model:      "claude-3-5-sonnet-20241022",
			StopReason: "end_turn",
			Usage:      &Usage{InputTokens: 12, OutputTokens: 8},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-ant-test", WithBaseURL(srv.URL))

	resp, err := client.CreateMessage(context.Background(), MessageRequest{
		Model:     "claude-3-5-sonnet-20241022",
		MaxTokens: 256,
		Messages:  []Message{{Role: "user", Content: "Hello!"}},
	})
	if err != nil {
		t.Fatalf("CreateMessage: %v", err)
	}
	if resp.ID != "msg-001" {
		t.Errorf("want ID msg-001, got %s", resp.ID)
	}
	if resp.Role != "assistant" {
		t.Errorf("want role assistant, got %s", resp.Role)
	}
	if len(resp.Content) != 1 {
		t.Fatalf("want 1 content block, got %d", len(resp.Content))
	}
	if resp.Content[0].Text != "Hello! I'm Claude." {
		t.Errorf("unexpected content: %s", resp.Content[0].Text)
	}
	if resp.StopReason != "end_turn" {
		t.Errorf("want stop_reason end_turn, got %s", resp.StopReason)
	}
	if resp.Usage.InputTokens != 12 {
		t.Errorf("want 12 input tokens, got %d", resp.Usage.InputTokens)
	}
	if resp.Usage.OutputTokens != 8 {
		t.Errorf("want 8 output tokens, got %d", resp.Usage.OutputTokens)
	}
}

func TestCreateMessage_WithSystem(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req MessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode body: %v", err)
		}
		if req.System != "You are a concise assistant." {
			t.Errorf("unexpected system: %s", req.System)
		}
		if req.MaxTokens != 100 {
			t.Errorf("want max_tokens=100, got %d", req.MaxTokens)
		}

		resp := MessageResponse{
			ID:         "msg-002",
			Type:       "message",
			Role:       "assistant",
			Content:    []ContentBlock{{Type: "text", Text: "Sure."}},
			Model:      "claude-3-haiku-20240307",
			StopReason: "end_turn",
			Usage:      &Usage{InputTokens: 20, OutputTokens: 2},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-ant-test", WithBaseURL(srv.URL))

	resp, err := client.CreateMessage(context.Background(), MessageRequest{
		Model:     "claude-3-haiku-20240307",
		System:    "You are a concise assistant.",
		MaxTokens: 100,
		Messages:  []Message{{Role: "user", Content: "Be brief."}},
	})
	if err != nil {
		t.Fatalf("CreateMessage: %v", err)
	}
	if resp.Content[0].Text != "Sure." {
		t.Errorf("unexpected text: %s", resp.Content[0].Text)
	}
}

func TestCreateMessage_MultiTurn(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req MessageRequest
		json.NewDecoder(r.Body).Decode(&req) //nolint:errcheck
		if len(req.Messages) != 3 {
			t.Errorf("want 3 messages, got %d", len(req.Messages))
		}
		if req.Messages[1].Role != "assistant" {
			t.Errorf("want messages[1].role=assistant, got %s", req.Messages[1].Role)
		}

		resp := MessageResponse{
			ID:         "msg-003",
			Type:       "message",
			Role:       "assistant",
			Content:    []ContentBlock{{Type: "text", Text: "Continuation."}},
			Model:      "claude-3-5-sonnet-20241022",
			StopReason: "end_turn",
			Usage:      &Usage{InputTokens: 30, OutputTokens: 5},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-ant-test", WithBaseURL(srv.URL))

	resp, err := client.CreateMessage(context.Background(), MessageRequest{
		Model:     "claude-3-5-sonnet-20241022",
		MaxTokens: 256,
		Messages: []Message{
			{Role: "user", Content: "Question 1"},
			{Role: "assistant", Content: "Answer 1"},
			{Role: "user", Content: "Question 2"},
		},
	})
	if err != nil {
		t.Fatalf("CreateMessage: %v", err)
	}
	if resp.Content[0].Text != "Continuation." {
		t.Errorf("unexpected response: %s", resp.Content[0].Text)
	}
}

func TestCreateMessage_WithTools(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req MessageRequest
		json.NewDecoder(r.Body).Decode(&req) //nolint:errcheck
		if len(req.Tools) != 1 {
			t.Errorf("want 1 tool, got %d", len(req.Tools))
		}
		if req.Tools[0].Name != "get_weather" {
			t.Errorf("unexpected tool name: %s", req.Tools[0].Name)
		}

		resp := MessageResponse{
			ID:         "msg-004",
			Type:       "message",
			Role:       "assistant",
			Content:    []ContentBlock{{Type: "text", Text: "Let me check the weather."}},
			Model:      "claude-3-5-sonnet-20241022",
			StopReason: "end_turn",
			Usage:      &Usage{InputTokens: 50, OutputTokens: 10},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-ant-test", WithBaseURL(srv.URL))

	resp, err := client.CreateMessage(context.Background(), MessageRequest{
		Model:     "claude-3-5-sonnet-20241022",
		MaxTokens: 256,
		Messages:  []Message{{Role: "user", Content: "What's the weather in Paris?"}},
		Tools: []Tool{
			{
				Name:        "get_weather",
				Description: "Get current weather for a location",
				InputSchema: map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"location": map[string]interface{}{"type": "string"},
					},
					"required": []string{"location"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateMessage with tools: %v", err)
	}
	if resp.ID != "msg-004" {
		t.Errorf("want ID msg-004, got %s", resp.ID)
	}
}

func TestCreateMessage_MaxTokensStop(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := MessageResponse{
			ID:         "msg-005",
			Type:       "message",
			Role:       "assistant",
			Content:    []ContentBlock{{Type: "text", Text: "This is a truncated"}},
			Model:      "claude-3-5-sonnet-20241022",
			StopReason: "max_tokens",
			Usage:      &Usage{InputTokens: 10, OutputTokens: 5},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-ant-test", WithBaseURL(srv.URL))

	resp, err := client.CreateMessage(context.Background(), MessageRequest{
		Model:     "claude-3-5-sonnet-20241022",
		MaxTokens: 5,
		Messages:  []Message{{Role: "user", Content: "Tell me a very long story"}},
	})
	if err != nil {
		t.Fatalf("CreateMessage: %v", err)
	}
	if resp.StopReason != "max_tokens" {
		t.Errorf("want stop_reason max_tokens, got %s", resp.StopReason)
	}
}

// ---------------------------------------------------------------------------
// Messages API — error paths
// ---------------------------------------------------------------------------

func TestCreateMessage_Error_Unauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"type":"error","error":{"type":"authentication_error","message":"Invalid API key"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("invalid-key", WithBaseURL(srv.URL))

	_, err := client.CreateMessage(context.Background(), MessageRequest{
		Model:     "claude-3-5-sonnet-20241022",
		MaxTokens: 100,
		Messages:  []Message{{Role: "user", Content: "Hello"}},
	})
	if err == nil {
		t.Fatal("expected error for invalid API key, got nil")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("expected 401 in error, got: %v", err)
	}
}

func TestCreateMessage_Error_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprint(w, `{"type":"error","error":{"type":"api_error","message":"Internal server error"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-ant-test", WithBaseURL(srv.URL))

	_, err := client.CreateMessage(context.Background(), MessageRequest{
		Model:     "claude-3-5-sonnet-20241022",
		MaxTokens: 100,
		Messages:  []Message{{Role: "user", Content: "Hello"}},
	})
	if err == nil {
		t.Fatal("expected error for server error, got nil")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("expected 500 in error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Content capture control
// ---------------------------------------------------------------------------

func TestCreateMessage_ContentCapture_Disabled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := MessageResponse{
			ID:         "priv-msg",
			Type:       "message",
			Role:       "assistant",
			Content:    []ContentBlock{{Type: "text", Text: "classified response"}},
			Model:      "claude-3-5-sonnet-20241022",
			StopReason: "end_turn",
			Usage:      &Usage{InputTokens: 5, OutputTokens: 3},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	if err := openlit.Init(openlit.Config{
		OtlpEndpoint:                 "http://localhost:4318",
		DisableTracing:               true,
		DisableMetrics:               true,
		DisableBatch:                 true,
		DisablePricingFetch:          true,
		DisableCaptureMessageContent: true,
	}); err != nil {
		t.Fatalf("openlit.Init: %v", err)
	}
	t.Cleanup(func() { openlit.Shutdown(context.Background()) }) //nolint:errcheck

	client := NewClient("sk-ant-test", WithBaseURL(srv.URL))
	// Response is still returned correctly; spans just won't have content attributes.
	resp, err := client.CreateMessage(context.Background(), MessageRequest{
		Model:     "claude-3-5-sonnet-20241022",
		MaxTokens: 50,
		Messages:  []Message{{Role: "user", Content: "classified prompt"}},
	})
	if err != nil {
		t.Fatalf("CreateMessage: %v", err)
	}
	if resp.ID != "priv-msg" {
		t.Errorf("want ID priv-msg, got %s", resp.ID)
	}
}

// ---------------------------------------------------------------------------
// Custom API version
// ---------------------------------------------------------------------------

func TestCreateMessage_CustomAPIVersion(t *testing.T) {
	const customVersion = "2024-01-01"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("anthropic-version") != customVersion {
			t.Errorf("want anthropic-version=%s, got %s", customVersion, r.Header.Get("anthropic-version"))
		}

		resp := MessageResponse{
			ID:      "msg-ver",
			Type:    "message",
			Role:    "assistant",
			Content: []ContentBlock{{Type: "text", Text: "ok"}},
			Model:   "claude-3-5-sonnet-20241022",
			Usage:   &Usage{InputTokens: 5, OutputTokens: 1},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient(
		"sk-ant-test",
		WithBaseURL(srv.URL),
		WithAPIVersion(customVersion),
	)

	resp, err := client.CreateMessage(context.Background(), MessageRequest{
		Model:     "claude-3-5-sonnet-20241022",
		MaxTokens: 10,
		Messages:  []Message{{Role: "user", Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("CreateMessage: %v", err)
	}
	if resp.ID != "msg-ver" {
		t.Errorf("want ID msg-ver, got %s", resp.ID)
	}
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

func TestCreateMessage_Streaming(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)

		events := []struct{ event, data string }{
			{"message_start", `{"type":"message_start","message":{"id":"msg-stream","type":"message","role":"assistant","content":[],"model":"claude-3-haiku-20240307","usage":{"input_tokens":10,"output_tokens":0}}}`},
			{"content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`},
			{"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`},
			{"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}`},
			{"content_block_stop", `{"type":"content_block_stop","index":0}`},
			{"message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}`},
			{"message_stop", `{"type":"message_stop"}`},
		}
		for _, ev := range events {
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.event, ev.data)
			w.(http.Flusher).Flush()
		}
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-ant-test", WithBaseURL(srv.URL))

	stream, err := client.CreateMessageStream(context.Background(), MessageRequest{
		Model:     "claude-3-haiku-20240307",
		MaxTokens: 40,
		Messages:  []Message{{Role: "user", Content: "Hi"}},
	})
	if err != nil {
		t.Fatalf("CreateMessageStream: %v", err)
	}
	defer stream.Close() //nolint:errcheck

	accumulated := ""
	eventCount := 0
	for {
		event, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("stream.Recv: %v", err)
		}
		if event.Delta != nil && event.Delta.Text != "" {
			accumulated += event.Delta.Text
			eventCount++
		}
	}

	if eventCount == 0 {
		t.Error("expected at least one content delta event")
	}
	if accumulated != "Hello there" {
		t.Errorf("want accumulated content %q, got %q", "Hello there", accumulated)
	}
}

func TestCreateMessage_Streaming_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"type":"error","error":{"type":"authentication_error","message":"Invalid API key"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("bad-key", WithBaseURL(srv.URL))

	_, err := client.CreateMessageStream(context.Background(), MessageRequest{
		Model:     "claude-3-haiku-20240307",
		MaxTokens: 40,
		Messages:  []Message{{Role: "user", Content: "Hi"}},
	})
	if err == nil {
		t.Fatal("expected error for streaming with invalid key, got nil")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("expected 401 in streaming error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Streaming cache-token span attributes
// ---------------------------------------------------------------------------

func setupSpanRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	otel.SetTracerProvider(tp)
	t.Cleanup(func() {
		_ = tp.Shutdown(context.Background())
		otel.SetTracerProvider(sdktrace.NewTracerProvider())
	})
	return sr
}

func attrInt(span sdktrace.ReadOnlySpan, key string) int64 {
	for _, a := range span.Attributes() {
		if string(a.Key) == key {
			return a.Value.AsInt64()
		}
	}
	return 0
}

func hasAttr(span sdktrace.ReadOnlySpan, key string) bool {
	for _, a := range span.Attributes() {
		if string(a.Key) == key {
			return true
		}
	}
	return false
}

func waitForEndedSpan(t *testing.T, sr *tracetest.SpanRecorder) sdktrace.ReadOnlySpan {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if ended := sr.Ended(); len(ended) >= 1 {
			return ended[0]
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("want 1 ended span, got %d", len(sr.Ended()))
	return nil
}

func drainStream(t *testing.T, stream *MessageStream) {
	t.Helper()
	defer stream.Close() //nolint:errcheck
	for {
		_, err := stream.Recv()
		if err == io.EOF {
			return
		}
		if err != nil {
			t.Fatalf("stream.Recv: %v", err)
		}
	}
}

func serveSSE(t *testing.T, events []struct{ event, data string }) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		for _, ev := range events {
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.event, ev.data)
			w.(http.Flusher).Flush()
		}
	}))
}

func TestCreateMessage_Streaming_CacheTokenAttributes(t *testing.T) {
	srv := serveSSE(t, []struct{ event, data string }{
		{"message_start", `{"type":"message_start","message":{"id":"msg-cache","type":"message","role":"assistant","content":[],"model":"claude-3-5-haiku-20241022","usage":{"input_tokens":10,"output_tokens":0,"cache_creation_input_tokens":1234,"cache_read_input_tokens":5678}}}`},
		{"content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`},
		{"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}`},
		{"content_block_stop", `{"type":"content_block_stop","index":0}`},
		{"message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}`},
		{"message_stop", `{"type":"message_stop"}`},
	})
	defer srv.Close()

	sr := setupSpanRecorder(t)
	client := NewClient("sk-ant-test", WithBaseURL(srv.URL))

	stream, err := client.CreateMessageStream(context.Background(), MessageRequest{
		Model:     "claude-3-5-haiku-20241022",
		MaxTokens: 40,
		Messages:  []Message{{Role: "user", Content: "Hi again"}},
	})
	if err != nil {
		t.Fatalf("CreateMessageStream: %v", err)
	}
	drainStream(t, stream)

	span := waitForEndedSpan(t, sr)
	if got := attrInt(span, semconv.GenAIUsageInputTokens); got != 10 {
		t.Errorf("input_tokens: want 10, got %d", got)
	}
	if got := attrInt(span, semconv.GenAIUsageOutputTokens); got != 2 {
		t.Errorf("output_tokens: want 2, got %d", got)
	}
	// total_tokens stays input+output, matching the non-streaming path.
	if got := attrInt(span, semconv.GenAIUsageTotalTokens); got != 12 {
		t.Errorf("total_tokens: want 12, got %d", got)
	}
	if got := attrInt(span, semconv.GenAIUsagePromptTokensDetailsCacheWrite); got != 1234 {
		t.Errorf("cache_write: want 1234, got %d", got)
	}
	if got := attrInt(span, semconv.GenAIUsagePromptTokensDetailsCacheRead); got != 5678 {
		t.Errorf("cache_read: want 5678, got %d", got)
	}
}

func TestCreateMessage_Streaming_CacheOnlySpan(t *testing.T) {
	// Cache-only usage (input=0, output=0) must still record cache attributes.
	// Previously the guard `if inputTokens > 0 || outputTokens > 0` skipped the block.
	srv := serveSSE(t, []struct{ event, data string }{
		{"message_start", `{"type":"message_start","message":{"id":"msg-cache-only","type":"message","role":"assistant","content":[],"model":"claude-3-5-haiku-20241022","usage":{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":500,"cache_creation_input_tokens":0}}}`},
		{"message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":0}}`},
		{"message_stop", `{"type":"message_stop"}`},
	})
	defer srv.Close()

	sr := setupSpanRecorder(t)
	client := NewClient("sk-ant-test", WithBaseURL(srv.URL))

	stream, err := client.CreateMessageStream(context.Background(), MessageRequest{
		Model:     "claude-3-5-haiku-20241022",
		MaxTokens: 1,
		Messages:  []Message{{Role: "user", Content: "cache-only"}},
	})
	if err != nil {
		t.Fatalf("CreateMessageStream: %v", err)
	}
	drainStream(t, stream)

	span := waitForEndedSpan(t, sr)
	if got := attrInt(span, semconv.GenAIUsagePromptTokensDetailsCacheRead); got != 500 {
		t.Errorf("cache_read: want 500, got %d", got)
	}
	if hasAttr(span, semconv.GenAIUsagePromptTokensDetailsCacheWrite) {
		t.Error("cache_write should be omitted when cache_creation_input_tokens is 0")
	}
	if got := attrInt(span, semconv.GenAIUsageTotalTokens); got != 0 {
		t.Errorf("total_tokens: want 0, got %d", got)
	}
}
