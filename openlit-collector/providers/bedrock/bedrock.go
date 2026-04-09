package http

// AWS Bedrock payload extractor for OBI.
//
// Endpoints:
//   POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/invoke
//   POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/invoke-with-response-stream
//
// Host pattern: bedrock-runtime.*.amazonaws.com
//
// Bedrock wraps multiple model providers (Anthropic, AI21, Cohere, Meta, etc.)
// Each has a different request/response format. The model ID in the URL indicates
// which format to use.

import (
	"encoding/json"
	"strings"
)

const BedrockHostPrefix = "bedrock-runtime."
const BedrockHostSuffix = ".amazonaws.com"

func IsBedrockHost(host string) bool {
	return strings.HasPrefix(host, BedrockHostPrefix) && strings.HasSuffix(host, BedrockHostSuffix)
}

type bedrockAnthropicRequest struct {
	Model         string   `json:"model"`
	MaxTokens     int      `json:"max_tokens"`
	Messages      json.RawMessage `json:"messages"`
	Temperature   *float64 `json:"temperature"`
	AnthropicVersion string `json:"anthropic_version"`
}

type bedrockAnthropicResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
	Model      string `json:"model"`
	StopReason string `json:"stop_reason"`
}

func BedrockExtractModelFromURL(path string) string {
	parts := strings.Split(path, "/model/")
	if len(parts) < 2 {
		return ""
	}
	modelPart := parts[1]
	if idx := strings.Index(modelPart, "/"); idx > 0 {
		modelPart = modelPart[:idx]
	}
	return modelPart
}

func BedrockExtractResponseTokens(buf []byte, modelID string) (inputTokens, outputTokens int) {
	if strings.Contains(modelID, "anthropic") {
		var resp bedrockAnthropicResponse
		if err := json.Unmarshal(buf, &resp); err != nil {
			return 0, 0
		}
		return resp.Usage.InputTokens, resp.Usage.OutputTokens
	}

	// Generic: try to find usage in top-level JSON
	var generic map[string]json.RawMessage
	if err := json.Unmarshal(buf, &generic); err != nil {
		return 0, 0
	}
	if usageRaw, ok := generic["usage"]; ok {
		var usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		}
		if err := json.Unmarshal(usageRaw, &usage); err == nil {
			return usage.InputTokens, usage.OutputTokens
		}
	}
	return 0, 0
}

func BedrockIsStreaming(path string) bool {
	return strings.Contains(path, "invoke-with-response-stream")
}

func BedrockOperationType(path string) string {
	if strings.Contains(path, "/invoke") {
		return "chat"
	}
	return "unknown"
}
