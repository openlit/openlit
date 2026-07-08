package vllm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openlit "github.com/openlit/openlit/sdk/go"
)

// initSDK initialises OpenLIT with all exporters disabled and registers cleanup.
func initSDK(t *testing.T) {
	t.Helper()
	if err := openlit.Init(openlit.Config{
		OtlpEndpoint:        "http://localhost:4318",
		Environment:         "test",
		ApplicationName:     "go-sdk-vllm-unit-tests",
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
			ID:     "chatcmpl-vllm-001",
			Object: "chat.completion",
			Model:  "facebook/opt-125m",
			Choices: []ChatCompletionChoice{
				{
					Index:        0,
					Message:      ChatMessage{Role: "assistant", Content: "Hello from vLLM!"},
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
		Model:    "facebook/opt-125m",
		Messages: []ChatMessage{{Role: "user", Content: "Hello"}},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if resp.ID != "chatcmpl-vllm-001" {
		t.Errorf("want ID chatcmpl-vllm-001, got %s", resp.ID)
	}
	if len(resp.Choices) != 1 {
		t.Fatalf("want 1 choice, got %d", len(resp.Choices))
	}
	if resp.Choices[0].Message.Content != "Hello from vLLM!" {
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

		resp := ChatCompletionResponse{
			ID:    "chatcmpl-vllm-002",
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
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if resp.ID != "chatcmpl-vllm-002" {
		t.Errorf("want ID chatcmpl-vllm-002, got %s", resp.ID)
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
			ID:    "chatcmpl-vllm-sys",
			Model: "facebook/opt-125m",
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
	client := NewClient(srv.URL)

	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model: "facebook/opt-125m",
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
			ID:    "chatcmpl-vllm-003",
			Model: "facebook/opt-125m",
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
		Model: "facebook/opt-125m",
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
			Model: "facebook/opt-125m",
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
		Model:    "facebook/opt-125m",
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
		Model:    "facebook/opt-125m",
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
	if client.baseURL != "http://127.0.0.1:8000/v1" {
		t.Errorf("want default baseURL http://127.0.0.1:8000/v1, got %s", client.baseURL)
	}
}

func TestNewClient_WithAPIKey(t *testing.T) {
	client := NewClient("http://localhost:8000/v1", WithAPIKey("test-key"))
	if client.apiKey != "test-key" {
		t.Errorf("want apiKey=test-key, got %s", client.apiKey)
	}
}

func TestNewClient_NoAPIKeyRequired(t *testing.T) {
	// vLLM local deployments don't require an API key
	client := NewClient("http://127.0.0.1:8000/v1")
	if client.apiKey != "" {
		t.Errorf("want empty apiKey for local vLLM, got %s", client.apiKey)
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
			`{"id":"cmpl-vllm-s1","object":"chat.completion.chunk","model":"facebook/opt-125m","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}`,
			`{"id":"cmpl-vllm-s1","object":"chat.completion.chunk","model":"facebook/opt-125m","choices":[{"index":0,"delta":{"content":" from"},"finish_reason":null}]}`,
			`{"id":"cmpl-vllm-s1","object":"chat.completion.chunk","model":"facebook/opt-125m","choices":[{"index":0,"delta":{"content":" vLLM"},"finish_reason":null}]}`,
			`{"id":"cmpl-vllm-s1","object":"chat.completion.chunk","model":"facebook/opt-125m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}`,
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
		Model:    "facebook/opt-125m",
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
	if accumulated != "Hello from vLLM" {
		t.Errorf("want accumulated content %q, got %q", "Hello from vLLM", accumulated)
	}
}

func TestChatCompletion_Streaming_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, `{"error":{"message":"vLLM server unavailable"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient(srv.URL)

	_, err := client.CreateChatCompletionStream(context.Background(), ChatCompletionRequest{
		Model:    "facebook/opt-125m",
		Messages: []ChatMessage{{Role: "user", Content: "Hi"}},
	})
	if err == nil {
		t.Fatal("expected error for unavailable server, got nil")
	}
	if !strings.Contains(err.Error(), "503") {
		t.Errorf("expected 503 in error, got: %v", err)
	}
}
