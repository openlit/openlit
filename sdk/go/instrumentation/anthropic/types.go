package anthropic

import "io"

// MessageRequest represents a message request to Anthropic
type MessageRequest struct {
	Model         string          `json:"model"`
	Messages      []Message       `json:"messages"`
	MaxTokens     int             `json:"max_tokens"`
	System        string          `json:"system,omitempty"`
	Temperature   float64         `json:"temperature,omitempty"`
	TopP          float64         `json:"top_p,omitempty"`
	TopK          int             `json:"top_k,omitempty"`
	StopSequences []string        `json:"stop_sequences,omitempty"`
	Stream        bool            `json:"stream,omitempty"`
	Tools         []Tool          `json:"tools,omitempty"`
	ToolChoice    interface{}     `json:"tool_choice,omitempty"`
	Metadata      *MessageMetadata `json:"metadata,omitempty"`
}

// Message represents a message in a conversation
type Message struct {
	Role    string        `json:"role"`
	Content interface{}   `json:"content"` // string or []ContentBlock
}

// ContentBlock represents a block of content
type ContentBlock struct {
	Type   string          `json:"type"`
	Text   string          `json:"text,omitempty"`
	Source *ImageSource    `json:"source,omitempty"`
	ID     string          `json:"id,omitempty"`
	Name   string          `json:"name,omitempty"`
	Input  interface{}     `json:"input,omitempty"`
}

// ImageSource represents an image source
type ImageSource struct {
	Type      string `json:"type"`
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
}

// Tool represents a tool definition
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

// MessageMetadata contains metadata about the message
type MessageMetadata struct {
	UserID string `json:"user_id,omitempty"`
}

// MessageResponse represents a response from Anthropic
type MessageResponse struct {
	ID           string         `json:"id"`
	Type         string         `json:"type"`
	Role         string         `json:"role"`
	Content      []ContentBlock `json:"content"`
	Model        string         `json:"model"`
	StopReason   string         `json:"stop_reason,omitempty"`
	StopSequence string         `json:"stop_sequence,omitempty"`
	Usage        *Usage         `json:"usage"`
}

// Usage represents token usage information
type Usage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens,omitempty"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens,omitempty"`
}

// MessageStreamEvent represents a streaming event
type MessageStreamEvent struct {
	Type    string          `json:"type"`
	Message *MessageResponse `json:"message,omitempty"`
	Index   int             `json:"index,omitempty"`
	Delta   *MessageDelta   `json:"delta,omitempty"`
	Usage   *Usage          `json:"usage,omitempty"`
}

// MessageDelta represents incremental changes in a stream
type MessageDelta struct {
	Type         string `json:"type,omitempty"`
	Text         string `json:"text,omitempty"`
	StopReason   string `json:"stop_reason,omitempty"`
	StopSequence string `json:"stop_sequence,omitempty"`
}

// MessageStream represents a streaming response
type MessageStream struct {
	reader chan MessageStreamEvent
	body   io.ReadCloser // underlying HTTP response body; Close() drains it
	err    error
	done   bool
}

// Recv receives the next event from the stream.
// Returns io.EOF when the stream ends cleanly; returns the underlying error
// if the stream was aborted.
func (s *MessageStream) Recv() (MessageStreamEvent, error) {
	event, ok := <-s.reader
	if !ok {
		if s.err != nil {
			return MessageStreamEvent{}, s.err
		}
		return MessageStreamEvent{}, io.EOF
	}
	return event, nil
}

// Close closes the underlying HTTP response body.
// The goroutine that reads the body will detect the close and exit,
// after which the reader channel is closed by defer in the goroutine.
func (s *MessageStream) Close() error {
	return s.body.Close()
}
