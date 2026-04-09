package http

// Cohere API payload extractor for OBI.
//
// Endpoints:
//   POST https://api.cohere.com/v2/chat
//   POST https://api.cohere.com/v1/embed
//   POST https://api.cohere.com/v1/rerank
//
// Request (chat): { "model": "command-r-plus", "messages": [...], "tools": [...] }
// Response (chat): { "text": "...", "usage": {"input_tokens": N, "output_tokens": N}, ... }
// Streaming: SSE with data: {"event_type": "text-generation", ...}

import (
	"encoding/json"
	"strings"
)

const CohereHost = "api.cohere.com"

type cohereRequest struct {
	Model       string          `json:"model"`
	Messages    json.RawMessage `json:"messages"`
	Tools       json.RawMessage `json:"tools"`
	Stream      bool            `json:"stream"`
	Temperature *float64        `json:"temperature"`
	MaxTokens   *int            `json:"max_tokens"`
}

type cohereResponse struct {
	Text  string `json:"text"`
	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
	FinishReason string `json:"finish_reason"`
}

type cohereStreamDelta struct {
	EventType string `json:"event_type"`
	Usage     *struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

func CohereExtractModel(buf []byte) string {
	var req cohereRequest
	if err := json.Unmarshal(buf, &req); err != nil {
		return ""
	}
	return req.Model
}

func CohereExtractRequestTokenEstimate(buf []byte) int {
	return -1
}

func CohereExtractResponseTokens(buf []byte) (inputTokens, outputTokens int) {
	var resp cohereResponse
	if err := json.Unmarshal(buf, &resp); err != nil {
		return 0, 0
	}
	return resp.Usage.InputTokens, resp.Usage.OutputTokens
}

func CohereIsStreaming(buf []byte) bool {
	var req cohereRequest
	if err := json.Unmarshal(buf, &req); err != nil {
		return false
	}
	return req.Stream
}

func CohereExtractStreamTokens(buf []byte) (inputTokens, outputTokens int) {
	lines := strings.Split(string(buf), "\n")
	for _, line := range lines {
		line = strings.TrimPrefix(line, "data: ")
		if line == "" || line == "[DONE]" {
			continue
		}
		var delta cohereStreamDelta
		if err := json.Unmarshal([]byte(line), &delta); err != nil {
			continue
		}
		if delta.Usage != nil {
			inputTokens = delta.Usage.InputTokens
			outputTokens = delta.Usage.OutputTokens
		}
	}
	return inputTokens, outputTokens
}

func CohereDetectToolCalls(buf []byte) bool {
	var req cohereRequest
	if err := json.Unmarshal(buf, &req); err != nil {
		return false
	}
	return len(req.Tools) > 0 && string(req.Tools) != "null"
}

func CohereExtractTemperature(buf []byte) float64 {
	var req cohereRequest
	if err := json.Unmarshal(buf, &req); err != nil || req.Temperature == nil {
		return -1
	}
	return *req.Temperature
}

func CohereOperationType(path string) string {
	if strings.Contains(path, "/chat") {
		return "chat"
	}
	if strings.Contains(path, "/embed") {
		return "embeddings"
	}
	if strings.Contains(path, "/rerank") {
		return "rerank"
	}
	return "unknown"
}

// IsCohereHost returns true if the given host is the Cohere API.
func IsCohereHost(host string) bool {
	return host == CohereHost
}
