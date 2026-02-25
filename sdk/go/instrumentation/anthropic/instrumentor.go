package anthropic

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/openlit/openlit/sdk/go/helpers"
	"github.com/openlit/openlit/sdk/go/semconv"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

const (
	defaultServerAddress = "api.anthropic.com"
	defaultServerPort    = 443
)

// createMessage handles non-streaming message requests
func (c *InstrumentedClient) createMessage(ctx context.Context, req MessageRequest, stream bool) (result *MessageResponse, retErr error) {
	tracer := otel.Tracer("openlit.anthropic")
	meter := otel.Meter("openlit.anthropic")
	tokenUsageHistogram, _ := meter.Int64Histogram(semconv.GenAIClientTokenUsage,
		metric.WithDescription("Number of tokens used in GenAI operations"),
		metric.WithUnit("{token}"))
	operationDurationHistogram, _ := meter.Float64Histogram(semconv.GenAIClientOperationDuration,
		metric.WithDescription("Duration of GenAI operations"),
		metric.WithUnit("s"))

	spanName := fmt.Sprintf("%s %s", semconv.GenAIOperationTypeChat, req.Model)
	ctx, span := tracer.Start(ctx, spanName, trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()

	startTime := time.Now()
	var errType string
	defer func() {
		if retErr != nil {
			if errType == "" {
				errType = fmt.Sprintf("%T", retErr)
			}
			operationDurationHistogram.Record(ctx, time.Since(startTime).Seconds(), metric.WithAttributes(
				attribute.String(semconv.GenAISystem, semconv.GenAISystemAnthropic),
				attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
				attribute.String(semconv.GenAIRequestModel, req.Model),
				attribute.String(semconv.ErrorType, errType),
			))
		}
	}()

	setRequestAttributes(span, req)

	reqBody, err := json.Marshal(req)
	if err != nil {
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/messages", bytes.NewReader(reqBody))
	if err != nil {
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.apiKey)
	httpReq.Header.Set("anthropic-version", c.apiVersion)

	httpResp, err := c.httpClient.Do(httpReq)
	if err != nil {
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(httpResp.Body)
		apiErr := fmt.Errorf("API error: %s - %s", httpResp.Status, string(body))
		helpers.RecordError(span, apiErr)
		errType = fmt.Sprintf("%d", httpResp.StatusCode)
		return nil, apiErr
	}

	var resp MessageResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&resp); err != nil {
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	duration := time.Since(startTime)

	setResponseAttributes(span, &resp, req.Model, duration)

	if resp.Usage != nil {
		cost := helpers.CalculateGlobalCost(resp.Model, resp.Usage.InputTokens, resp.Usage.OutputTokens)
		semconv.SetFloat64Attribute(span, semconv.GenAIUsageCost, cost)

		// Record OTel metrics
		attrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemAnthropic),
			attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
			attribute.String(semconv.GenAIRequestModel, req.Model),
			attribute.String(semconv.GenAIResponseModel, resp.Model),
		}
		tokenUsageHistogram.Record(ctx, int64(resp.Usage.InputTokens),
			metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "input"))...))
		tokenUsageHistogram.Record(ctx, int64(resp.Usage.OutputTokens),
			metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "output"))...))
		operationDurationHistogram.Record(ctx, duration.Seconds(), metric.WithAttributes(attrs...))
	}

	span.SetStatus(codes.Ok, "")
	return &resp, nil
}

// setRequestAttributes sets common request attributes on a span
func setRequestAttributes(span trace.Span, req MessageRequest) {
	semconv.SetStringAttribute(span, semconv.GenAIOperationName, semconv.GenAIOperationTypeChat)
	semconv.SetStringAttribute(span, semconv.GenAISystem, semconv.GenAISystemAnthropic)
	semconv.SetStringAttribute(span, semconv.GenAIRequestModel, req.Model)
	semconv.SetStringAttribute(span, semconv.ServerAddress, defaultServerAddress)
	semconv.SetIntAttribute(span, semconv.ServerPort, defaultServerPort)
	semconv.SetBoolAttribute(span, semconv.GenAIRequestIsStream, req.Stream)

	if req.MaxTokens > 0 {
		semconv.SetIntAttribute(span, semconv.GenAIRequestMaxTokens, req.MaxTokens)
	}
	if req.Temperature > 0 {
		semconv.SetFloat64Attribute(span, semconv.GenAIRequestTemperature, req.Temperature)
	}
	if req.TopP > 0 {
		semconv.SetFloat64Attribute(span, semconv.GenAIRequestTopP, req.TopP)
	}
	if req.TopK > 0 {
		semconv.SetIntAttribute(span, semconv.GenAIRequestTopK, req.TopK)
	}
	if len(req.StopSequences) > 0 {
		semconv.SetStringSliceAttribute(span, semconv.GenAIRequestStopSequences, req.StopSequences)
	}

	if helpers.GetCaptureMessageContent() {
		// Set system instructions if provided
		if req.System != "" {
			semconv.SetStringAttribute(span, semconv.GenAISystemInstructions, req.System)
		}

		// Convert messages to structured format
		messages := make([]semconv.Message, 0, len(req.Messages))
		for _, msg := range req.Messages {
			m := semconv.Message{Role: msg.Role}
			switch v := msg.Content.(type) {
			case string:
				m.Content = v
			case []ContentBlock:
				for _, block := range v {
					if block.Type == "text" && block.Text != "" {
						m.Content = block.Text
						break
					}
				}
			}
			messages = append(messages, m)
		}
		if len(messages) > 0 {
			semconv.SetMessagesAttribute(span, semconv.GenAIInputMessages, messages) //nolint:errcheck
		}
	}

	// Set tool definitions if provided
	if len(req.Tools) > 0 {
		tools := make([]semconv.ToolDefinition, len(req.Tools))
		for i, tool := range req.Tools {
			tools[i] = semconv.ToolDefinition{Type: "function"}
			tools[i].Function.Name = tool.Name
			tools[i].Function.Description = tool.Description
			tools[i].Function.Parameters = tool.InputSchema
		}
		semconv.SetToolDefinitionsAttribute(span, semconv.GenAIToolDefinitions, tools) //nolint:errcheck
	}
}

// setResponseAttributes sets common response attributes on a span
func setResponseAttributes(span trace.Span, resp *MessageResponse, requestModel string, duration time.Duration) {
	semconv.SetStringAttribute(span, semconv.GenAIResponseID, resp.ID)
	semconv.SetStringAttribute(span, semconv.GenAIResponseModel, resp.Model)

	if resp.StopReason != "" {
		semconv.SetStringSliceAttribute(span, semconv.GenAIResponseFinishReasons, []string{resp.StopReason})
	}

	if resp.Usage != nil {
		semconv.SetIntAttribute(span, semconv.GenAIUsageInputTokens, resp.Usage.InputTokens)
		semconv.SetIntAttribute(span, semconv.GenAIUsageOutputTokens, resp.Usage.OutputTokens)
		semconv.SetIntAttribute(span, semconv.GenAIUsageTotalTokens, resp.Usage.InputTokens+resp.Usage.OutputTokens)
		if resp.Usage.CacheCreationInputTokens > 0 {
			semconv.SetIntAttribute(span, semconv.GenAIUsagePromptTokensDetailsCacheWrite, resp.Usage.CacheCreationInputTokens)
		}
		if resp.Usage.CacheReadInputTokens > 0 {
			semconv.SetIntAttribute(span, semconv.GenAIUsagePromptTokensDetailsCacheRead, resp.Usage.CacheReadInputTokens)
		}
	}

	// Extract tool_use blocks from the model's response
	toolUseBlocks := make([]ContentBlock, 0)
	for _, block := range resp.Content {
		if block.Type == "tool_use" {
			toolUseBlocks = append(toolUseBlocks, block)
		}
	}
	if len(toolUseBlocks) > 0 {
		names := make([]string, 0, len(toolUseBlocks))
		ids := make([]string, 0, len(toolUseBlocks))
		args := make([]string, 0, len(toolUseBlocks))
		for _, block := range toolUseBlocks {
			if block.Name != "" {
				names = append(names, block.Name)
			}
			if block.ID != "" {
				ids = append(ids, block.ID)
			}
			if block.Input != nil {
				if inputJSON, err := json.Marshal(block.Input); err == nil {
					args = append(args, string(inputJSON))
				}
			}
		}
		semconv.SetStringAttribute(span, semconv.GenAIToolName, strings.Join(names, ", "))
		semconv.SetStringAttribute(span, semconv.GenAIToolCallID, strings.Join(ids, ", "))
		semconv.SetStringSliceAttribute(span, semconv.GenAIToolCallArguments, args)
	}

	if helpers.GetCaptureMessageContent() && len(resp.Content) > 0 {
		completionText := extractContentText(resp.Content)
		if completionText != "" {
			semconv.SetStringAttribute(span, semconv.GenAICompletion, completionText)
		}

		outputMessages := []semconv.Message{
			{Role: resp.Role, Content: completionText},
		}
		semconv.SetMessagesAttribute(span, semconv.GenAIOutputMessages, outputMessages) //nolint:errcheck
	}
}

// extractContentText extracts text from content blocks
func extractContentText(content []ContentBlock) string {
	var text string
	for _, block := range content {
		if block.Type == "text" && block.Text != "" {
			if text != "" {
				text += "\n"
			}
			text += block.Text
		}
	}
	return text
}
