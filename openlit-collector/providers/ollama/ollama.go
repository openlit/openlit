package http

// Ollama payload extractor for OBI.
// Ollama exposes an OpenAI-compatible API on localhost.
//
// Endpoints:
//   POST http://localhost:11434/v1/chat/completions  (OpenAI-compatible)
//   POST http://localhost:11434/api/chat             (native Ollama API)
//   POST http://localhost:11434/api/generate
//
// The OpenAI-compatible endpoint reuses the OpenAI parser.
// The native Ollama API has its own format.

import (
	"encoding/json"
	"strings"
)

const OllamaDefaultHost = "localhost:11434"
const OllamaDefaultHostAlt = "127.0.0.1:11434"

func IsOllamaHost(host string) bool {
	return host == OllamaDefaultHost || host == OllamaDefaultHostAlt
}

func OllamaIsOpenAICompatiblePath(path string) bool {
	return strings.HasPrefix(path, "/v1/")
}

type ollamaChatRequest struct {
	Model    string          `json:"model"`
	Messages json.RawMessage `json:"messages"`
	Stream   *bool           `json:"stream"`
	Options  *struct {
		Temperature *float64 `json:"temperature"`
	} `json:"options"`
}

type ollamaChatResponse struct {
	Model              string `json:"model"`
	Done               bool   `json:"done"`
	TotalDuration      int64  `json:"total_duration"`
	PromptEvalCount    int    `json:"prompt_eval_count"`
	EvalCount          int    `json:"eval_count"`
}

func OllamaExtractModel(buf []byte) string {
	var req ollamaChatRequest
	if err := json.Unmarshal(buf, &req); err != nil {
		return ""
	}
	return req.Model
}

func OllamaExtractResponseTokens(buf []byte) (inputTokens, outputTokens int) {
	var resp ollamaChatResponse
	if err := json.Unmarshal(buf, &resp); err != nil {
		return 0, 0
	}
	return resp.PromptEvalCount, resp.EvalCount
}

func OllamaIsStreaming(buf []byte) bool {
	var req ollamaChatRequest
	if err := json.Unmarshal(buf, &req); err != nil {
		return false
	}
	if req.Stream == nil {
		return true // Ollama defaults to streaming
	}
	return *req.Stream
}

func OllamaOperationType(path string) string {
	if strings.Contains(path, "/chat") {
		return "chat"
	}
	if strings.Contains(path, "/generate") {
		return "generate"
	}
	if strings.Contains(path, "/embed") {
		return "embeddings"
	}
	return "unknown"
}
