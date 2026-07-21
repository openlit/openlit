package groq

import (
	"io"
	"sync"
)

const defaultModel = "facebook/opt-125m"

// ChatCompletionRequest represents a chat completion request to vLLM.
// vLLM uses the OpenAI-compatible API so this mirrors the OpenAI request shape.
type ChatCompletionRequest struct {
	Model            string         `json:"model"`
	Messages         []ChatMessage  `json:"messages"`
	Temperature      float64        `json:"temperature,omitempty"`
	TopP             float64        `json:"top_p,omitempty"`
	TopK             int            `json:"top_k,omitempty"`
	N                int            `json:"n,omitempty"`
	Stream           bool           `json:"stream,omitempty"`
	Stop             []string       `json:"stop,omitempty"`
	MaxTokens        int            `json:"max_tokens,omitempty"`
	PresencePenalty  float64        `json:"presence_penalty,omitempty"`
	FrequencyPenalty float64        `json:"frequency_penalty,omitempty"`
	User             string         `json:"user,omitempty"`
	Seed             int            `json:"seed,omitempty"`
	Tools            []Tool         `json:"tools,omitempty"`
	ToolChoice       interface{}    `json:"tool_choice,omitempty"`
	StreamOptions    *StreamOptions `json:"stream_options,omitempty"`
}

// ChatMessage represents a message in a conversation
type ChatMessage struct {
	Role       string     `json:"role"`
	Content    string     `json:"content,omitempty"`
	Name       string     `json:"name,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

// ToolCall represents a tool/function call
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// Tool represents a tool/function definition
type Tool struct {
	Type     string   `json:"type"`
	Function Function `json:"function"`
}

// Function represents a function definition
type Function struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Parameters  map[string]interface{} `json:"parameters,omitempty"`
}

// StreamOptions configures streaming behavior
type StreamOptions struct {
	IncludeUsage bool `json:"include_usage,omitempty"`
}

// ChatCompletionResponse represents a chat completion response from vLLM
type ChatCompletionResponse struct {
	ID      string                 `json:"id"`
	Object  string                 `json:"object"`
	Created int64                  `json:"created"`
	Model   string                 `json:"model"`
	Choices []ChatCompletionChoice `json:"choices"`
	Usage   *Usage                 `json:"usage,omitempty"`
}

// ChatCompletionChoice represents a completion choice
type ChatCompletionChoice struct {
	Index        int         `json:"index"`
	Message      ChatMessage `json:"message"`
	FinishReason string      `json:"finish_reason"`
	Logprobs     interface{} `json:"logprobs,omitempty"`
}

// ChatCompletionChunk represents a streaming chunk from vLLM
type ChatCompletionChunk struct {
	ID      string                      `json:"id"`
	Object  string                      `json:"object"`
	Created int64                       `json:"created"`
	Model   string                      `json:"model"`
	Choices []ChatCompletionChunkChoice `json:"choices"`
	Usage   *Usage                      `json:"usage,omitempty"`
}

// ChatCompletionChunkChoice represents a streaming choice
type ChatCompletionChunkChoice struct {
	Index        int              `json:"index"`
	Delta        ChatMessageDelta `json:"delta"`
	FinishReason string           `json:"finish_reason,omitempty"`
}

// ChatMessageDelta represents incremental message content in streaming
type ChatMessageDelta struct {
	Role      string     `json:"role,omitempty"`
	Content   string     `json:"content,omitempty"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

// Usage represents token usage — vLLM uses OpenAI-compatible field names
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// ChatCompletionStream represents a streaming response from vLLM
type ChatCompletionStream struct {
	reader    chan ChatCompletionChunk
	body      io.ReadCloser
	err       error
	done      bool
	closeOnce sync.Once
	closeErr  error
}

// Recv receives the next chunk from the stream.
// Returns io.EOF when the stream ends cleanly.
func (s *ChatCompletionStream) Recv() (ChatCompletionChunk, error) {
	chunk, ok := <-s.reader
	if !ok {
		if s.err != nil {
			return ChatCompletionChunk{}, s.err
		}
		return ChatCompletionChunk{}, io.EOF
	}
	return chunk, nil
}

// Close closes the underlying HTTP response body (safe to call multiple times).
func (s *ChatCompletionStream) Close() error {
	s.closeOnce.Do(func() {
		if s.body != nil {
			s.closeErr = s.body.Close()
		}
	})
	return s.closeErr
}
