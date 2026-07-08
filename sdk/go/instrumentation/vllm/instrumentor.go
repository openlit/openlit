package vllm

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
	// defaultServerAddress is the default vLLM server address
	defaultServerAddress = "127.0.0.1"
	// defaultServerPort is the default vLLM server port
	defaultServerPort = 8000
)

// createChatCompletion handles non-streaming chat completions
func (c *InstrumentedClient) createChatCompletion(ctx context.Context, req ChatCompletionRequest) (result *ChatCompletionResponse, retErr error) {
	tracer := otel.Tracer("openlit.vllm")
	meter := otel.Meter("openlit.vllm")

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
			operationDurationHistogram.Record(ctx, time.Since(startTime).Seconds(),
				metric.WithAttributes(
					attribute.String(semconv.GenAISystem, semconv.GenAISystemVLLM),
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

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/chat/completions", bytes.NewReader(reqBody))
	if err != nil {
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

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

	var resp ChatCompletionResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&resp); err != nil {
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	duration := time.Since(startTime)

	setResponseAttributes(span, &resp, req.Model, duration)

	if resp.Usage != nil {
		cost := helpers.CalculateGlobalCost(resp.Model, resp.Usage.PromptTokens, resp.Usage.CompletionTokens)
		semconv.SetFloat64Attribute(span, semconv.GenAIUsageCost, cost)

		attrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemVLLM),
			attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
			attribute.String(semconv.GenAIRequestModel, req.Model),
			attribute.String(semconv.GenAIResponseModel, resp.Model),
		}
		tokenUsageHistogram.Record(ctx, int64(resp.Usage.PromptTokens),
			metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "input"))...))
		tokenUsageHistogram.Record(ctx, int64(resp.Usage.CompletionTokens),
			metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "output"))...))
		operationDurationHistogram.Record(ctx, duration.Seconds(), metric.WithAttributes(attrs...))
	}

	span.SetStatus(codes.Ok, "")
	return &resp, nil
}

// setRequestAttributes sets common request attributes on a span
func setRequestAttributes(span trace.Span, req ChatCompletionRequest) {
	semconv.SetStringAttribute(span, semconv.GenAIOperationName, semconv.GenAIOperationTypeChat)
	semconv.SetStringAttribute(span, semconv.GenAISystem, semconv.GenAISystemVLLM)
	semconv.SetStringAttribute(span, semconv.GenAIProviderName, semconv.GenAISystemVLLM)
	semconv.SetStringAttribute(span, semconv.GenAIRequestModel, req.Model)
	semconv.SetStringAttribute(span, semconv.ServerAddress, defaultServerAddress)
	semconv.SetIntAttribute(span, semconv.ServerPort, defaultServerPort)
	semconv.SetBoolAttribute(span, semconv.GenAIRequestIsStream, req.Stream)

	if req.User != "" {
		semconv.SetStringAttribute(span, semconv.GenAIRequestUser, req.User)
	}
	if req.Temperature > 0 {
		semconv.SetFloat64Attribute(span, semconv.GenAIRequestTemperature, req.Temperature)
	}
	if req.TopP > 0 {
		semconv.SetFloat64Attribute(span, semconv.GenAIRequestTopP, req.TopP)
	}
	if req.MaxTokens > 0 {
		semconv.SetIntAttribute(span, semconv.GenAIRequestMaxTokens, req.MaxTokens)
	}
	if req.FrequencyPenalty != 0 {
		semconv.SetFloat64Attribute(span, semconv.GenAIRequestFrequencyPenalty, req.FrequencyPenalty)
	}
	if req.PresencePenalty != 0 {
		semconv.SetFloat64Attribute(span, semconv.GenAIRequestPresencePenalty, req.PresencePenalty)
	}
	if len(req.Stop) > 0 {
		semconv.SetStringSliceAttribute(span, semconv.GenAIRequestStopSequences, req.Stop)
	}
	if req.Seed > 0 {
		semconv.SetIntAttribute(span, semconv.GenAIRequestSeed, req.Seed)
	}
	if req.N > 0 {
		semconv.SetIntAttribute(span, semconv.GenAIRequestChoiceCount, req.N)
	}

	// Capture message content if enabled
	if helpers.GetCaptureMessageContent() {
		messages := make([]semconv.Message, 0, len(req.Messages))
		for _, msg := range req.Messages {
			messages = append(messages, semconv.Message{
				Role:    msg.Role,
				Content: msg.Content,
			})
		}
		if len(messages) > 0 {
			semconv.SetMessagesAttribute(span, semconv.GenAIInputMessages, messages) //nolint:errcheck
		}
	}
}

// setResponseAttributes sets common response attributes on a span
func setResponseAttributes(span trace.Span, resp *ChatCompletionResponse, requestModel string, duration time.Duration) {
	semconv.SetStringAttribute(span, semconv.GenAIResponseID, resp.ID)
	semconv.SetStringAttribute(span, semconv.GenAIResponseModel, resp.Model)

	if len(resp.Choices) > 0 {
		finishReasons := make([]string, 0, len(resp.Choices))
		for _, choice := range resp.Choices {
			if choice.FinishReason != "" {
				finishReasons = append(finishReasons, choice.FinishReason)
			}
		}
		if len(finishReasons) > 0 {
			semconv.SetStringSliceAttribute(span, semconv.GenAIResponseFinishReasons, finishReasons)
		}

		// Extract tool calls from the model response
		if len(resp.Choices[0].Message.ToolCalls) > 0 {
			toolCalls := resp.Choices[0].Message.ToolCalls
			names := make([]string, 0, len(toolCalls))
			ids := make([]string, 0, len(toolCalls))
			args := make([]string, 0, len(toolCalls))
			types := make([]string, 0, len(toolCalls))
			for _, tc := range toolCalls {
				if tc.Function.Name != "" {
					names = append(names, tc.Function.Name)
				}
				if tc.ID != "" {
					ids = append(ids, tc.ID)
				}
				if tc.Function.Arguments != "" {
					args = append(args, tc.Function.Arguments)
				}
				if tc.Type != "" {
					types = append(types, tc.Type)
				}
			}
			semconv.SetStringAttribute(span, semconv.GenAIToolName, strings.Join(names, ", "))
			semconv.SetStringAttribute(span, semconv.GenAIToolCallID, strings.Join(ids, ", "))
			semconv.SetStringSliceAttribute(span, semconv.GenAIToolCallArguments, args)
			semconv.SetStringAttribute(span, semconv.GenAIToolType, strings.Join(types, ", "))
		}

		// Capture completion content if enabled
		if helpers.GetCaptureMessageContent() {
			outputMessages := make([]semconv.Message, 0, len(resp.Choices))
			for _, choice := range resp.Choices {
				outputMessages = append(outputMessages, semconv.Message{
					Role:    choice.Message.Role,
					Content: choice.Message.Content,
				})
			}
			semconv.SetMessagesAttribute(span, semconv.GenAIOutputMessages, outputMessages) //nolint:errcheck
		}
	}

	if resp.Usage != nil {
		semconv.SetIntAttribute(span, semconv.GenAIUsageInputTokens, resp.Usage.PromptTokens)
		semconv.SetIntAttribute(span, semconv.GenAIUsageOutputTokens, resp.Usage.CompletionTokens)
		semconv.SetIntAttribute(span, semconv.GenAIUsageTotalTokens, resp.Usage.TotalTokens)
	}
}
