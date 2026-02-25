package openai

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
		if r.Header.Get("Authorization") == "" {
			t.Error("missing Authorization header")
		}

		resp := ChatCompletionResponse{
			ID:     "chatcmpl-001",
			Object: "chat.completion",
			Model:  "gpt-4o",
			Choices: []ChatCompletionChoice{
				{
					Index:        0,
					Message:      ChatMessage{Role: "assistant", Content: "Hello! How can I help?"},
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
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:    "gpt-4o",
		Messages: []ChatMessage{{Role: "user", Content: "Hello"}},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if resp.ID != "chatcmpl-001" {
		t.Errorf("want ID chatcmpl-001, got %s", resp.ID)
	}
	if len(resp.Choices) != 1 {
		t.Fatalf("want 1 choice, got %d", len(resp.Choices))
	}
	if resp.Choices[0].Message.Content != "Hello! How can I help?" {
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
			ID:    "chatcmpl-002",
			Model: "gpt-4o-mini",
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
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:       "gpt-4o-mini",
		Messages:    []ChatMessage{{Role: "user", Content: "Help"}},
		Temperature: 0.7,
		MaxTokens:   100,
		TopP:        0.9,
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if resp.ID != "chatcmpl-002" {
		t.Errorf("want ID chatcmpl-002, got %s", resp.ID)
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
			ID:    "chatcmpl-sys",
			Model: "gpt-4o-mini",
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
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model: "gpt-4o-mini",
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
			ID:    "chatcmpl-003",
			Model: "gpt-4o",
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
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model: "gpt-4o",
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
			ID:    "chatcmpl-004",
			Model: "gpt-4o",
			Choices: []ChatCompletionChoice{
				{
					Message: ChatMessage{
						Role:    "assistant",
						Content: "",
						ToolCalls: []ToolCall{
							{
								ID:   "call_abc",
								Type: "function",
								Function: struct {
									Name      string `json:"name"`
									Arguments string `json:"arguments"`
								}{Name: "get_weather", Arguments: `{"location":"London"}`},
							},
						},
					},
					FinishReason: "tool_calls",
				},
			},
			Usage: &Usage{PromptTokens: 50, CompletionTokens: 20, TotalTokens: 70},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:    "gpt-4o",
		Messages: []ChatMessage{{Role: "user", Content: "What's the weather in London?"}},
		Tools: []Tool{
			{
				Type: "function",
				Function: Function{
					Name:        "get_weather",
					Description: "Get the current weather for a location",
					Parameters: map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"location": map[string]interface{}{"type": "string"},
						},
						"required": []string{"location"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion with tools: %v", err)
	}
	if resp.Choices[0].FinishReason != "tool_calls" {
		t.Errorf("want finish_reason=tool_calls, got %s", resp.Choices[0].FinishReason)
	}
	if len(resp.Choices[0].Message.ToolCalls) != 1 {
		t.Fatalf("want 1 tool call, got %d", len(resp.Choices[0].Message.ToolCalls))
	}
	if resp.Choices[0].Message.ToolCalls[0].Function.Name != "get_weather" {
		t.Errorf("unexpected tool call name: %s", resp.Choices[0].Message.ToolCalls[0].Function.Name)
	}
	if resp.Choices[0].Message.ToolCalls[0].Function.Arguments != `{"location":"London"}` {
		t.Errorf("unexpected arguments: %s", resp.Choices[0].Message.ToolCalls[0].Function.Arguments)
	}
}

// ---------------------------------------------------------------------------
// Chat completion — error paths
// ---------------------------------------------------------------------------

func TestChatCompletion_Error_Unauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"error":{"message":"Invalid API key","type":"invalid_request_error"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("invalid-key", WithBaseURL(srv.URL))

	_, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:    "gpt-4o",
		Messages: []ChatMessage{{Role: "user", Content: "Hello"}},
	})
	if err == nil {
		t.Fatal("expected error for invalid API key, got nil")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("expected 401 in error, got: %v", err)
	}
}

func TestChatCompletion_Error_RateLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprint(w, `{"error":{"message":"Rate limit exceeded","type":"requests"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	_, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:    "gpt-4o",
		Messages: []ChatMessage{{Role: "user", Content: "Hello"}},
	})
	if err == nil {
		t.Fatal("expected error for rate limit, got nil")
	}
	if !strings.Contains(err.Error(), "429") {
		t.Errorf("expected 429 in error, got: %v", err)
	}
}

func TestChatCompletion_Error_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprint(w, `{"error":{"message":"Internal server error","type":"server_error"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	_, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:    "gpt-4o",
		Messages: []ChatMessage{{Role: "user", Content: "Hello"}},
	})
	if err == nil {
		t.Fatal("expected error for server error, got nil")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("expected 500 in error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Chat completion — content capture
// ---------------------------------------------------------------------------

func TestChatCompletion_ContentCapture_Disabled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := ChatCompletionResponse{
			ID:    "priv-001",
			Model: "gpt-4o",
			Choices: []ChatCompletionChoice{
				{Message: ChatMessage{Role: "assistant", Content: "classified"}, FinishReason: "stop"},
			},
			Usage: &Usage{PromptTokens: 5, CompletionTokens: 2, TotalTokens: 7},
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

	client := NewClient("sk-test", WithBaseURL(srv.URL))
	// Response is still returned correctly; spans just won't have content attributes.
	resp, err := client.CreateChatCompletion(context.Background(), ChatCompletionRequest{
		Model:    "gpt-4o",
		Messages: []ChatMessage{{Role: "user", Content: "classified prompt"}},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if resp.ID != "priv-001" {
		t.Errorf("want ID priv-001, got %s", resp.ID)
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
			`{"id":"cmpl-s1","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}`,
			`{"id":"cmpl-s1","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}`,
			`{"id":"cmpl-s1","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}`,
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
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	stream, err := client.CreateChatCompletionStream(context.Background(), ChatCompletionRequest{
		Model:    "gpt-4o-mini",
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
	if accumulated != "Hello world" {
		t.Errorf("want accumulated content %q, got %q", "Hello world", accumulated)
	}
}

func TestChatCompletion_Streaming_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"error":{"message":"Invalid API key"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("bad-key", WithBaseURL(srv.URL))

	_, err := client.CreateChatCompletionStream(context.Background(), ChatCompletionRequest{
		Model:    "gpt-4o-mini",
		Messages: []ChatMessage{{Role: "user", Content: "Hi"}},
	})
	if err == nil {
		t.Fatal("expected error for streaming with invalid key, got nil")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("expected 401 in streaming error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

func TestEmbedding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/embeddings" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		resp := EmbeddingResponse{
			Object: "list",
			Model:  "text-embedding-3-small",
			Data: []EmbeddingData{
				{Object: "embedding", Embedding: []float64{0.1, 0.2, 0.3, 0.4, 0.5}, Index: 0},
			},
			Usage: &EmbeddingUsage{PromptTokens: 3, TotalTokens: 3},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	resp, err := client.CreateEmbedding(context.Background(), EmbeddingRequest{
		Model: "text-embedding-3-small",
		Input: "Hello, world!",
	})
	if err != nil {
		t.Fatalf("CreateEmbedding: %v", err)
	}
	if resp.Model != "text-embedding-3-small" {
		t.Errorf("want model text-embedding-3-small, got %s", resp.Model)
	}
	if len(resp.Data) != 1 {
		t.Fatalf("want 1 embedding, got %d", len(resp.Data))
	}
	if len(resp.Data[0].Embedding) != 5 {
		t.Errorf("want dim=5, got %d", len(resp.Data[0].Embedding))
	}
	if resp.Usage.TotalTokens != 3 {
		t.Errorf("want 3 total tokens, got %d", resp.Usage.TotalTokens)
	}
}

func TestEmbedding_BatchInput(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := EmbeddingResponse{
			Object: "list",
			Model:  "text-embedding-3-large",
			Data: []EmbeddingData{
				{Embedding: []float64{0.1, 0.2}, Index: 0},
				{Embedding: []float64{0.3, 0.4}, Index: 1},
			},
			Usage: &EmbeddingUsage{PromptTokens: 6, TotalTokens: 6},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	resp, err := client.CreateEmbedding(context.Background(), EmbeddingRequest{
		Model: "text-embedding-3-large",
		Input: []string{"First sentence", "Second sentence"},
	})
	if err != nil {
		t.Fatalf("CreateEmbedding batch: %v", err)
	}
	if len(resp.Data) != 2 {
		t.Errorf("want 2 embeddings, got %d", len(resp.Data))
	}
	if resp.Data[0].Index != 0 || resp.Data[1].Index != 1 {
		t.Error("unexpected embedding indices")
	}
}

func TestEmbedding_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":{"message":"Invalid model"}}`)
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	_, err := client.CreateEmbedding(context.Background(), EmbeddingRequest{
		Model: "invalid-model",
		Input: "test",
	})
	if err == nil {
		t.Fatal("expected error for invalid model, got nil")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("expected 400 in error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

func TestImageGeneration(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/images/generations" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		var req ImageRequest
		json.NewDecoder(r.Body).Decode(&req) //nolint:errcheck
		if req.Model != "dall-e-3" {
			t.Errorf("want model dall-e-3, got %s", req.Model)
		}
		if req.Size != "1024x1024" {
			t.Errorf("want size=1024x1024, got %s", req.Size)
		}

		resp := ImageResponse{
			Created: 1700000000,
			Data: []ImageData{
				{URL: "https://example.com/img.png", RevisedPrompt: "A serene lake at dawn"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer srv.Close()

	initSDK(t)
	client := NewClient("sk-test", WithBaseURL(srv.URL))

	resp, err := client.CreateImage(context.Background(), ImageRequest{
		Model:  "dall-e-3",
		Prompt: "A serene lake at dawn",
		Size:   "1024x1024",
	})
	if err != nil {
		t.Fatalf("CreateImage: %v", err)
	}
	if len(resp.Data) != 1 {
		t.Fatalf("want 1 image, got %d", len(resp.Data))
	}
	if resp.Data[0].URL != "https://example.com/img.png" {
		t.Errorf("unexpected URL: %s", resp.Data[0].URL)
	}
	if resp.Data[0].RevisedPrompt != "A serene lake at dawn" {
		t.Errorf("unexpected revised prompt: %s", resp.Data[0].RevisedPrompt)
	}
}
