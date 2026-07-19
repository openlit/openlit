package mistral

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	openlit "github.com/openlit/openlit/sdk/go"
	"github.com/openlit/openlit/sdk/go/helpers"
	"github.com/openlit/openlit/sdk/go/semconv"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

// createChatCompletion handles non-streaming chat completions
func (c *InstrumentedClient) createChatCompletion(ctx context.Context, req ChatCompletionRequest) (result *ChatCompletionResponse, retErr error) {
	ensureMetrics()

	if req.Model == "" {
		req.Model = defaultModel
	}

	tracer := c.tracer
	if tracer == nil {
		tracer = otel.Tracer("openlit.mistral")
	}

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
					attribute.String(semconv.GenAISystem, semconv.GenAISystemMistral),
					attribute.String(semconv.GenAIProviderName, semconv.GenAISystemMistral),
					attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
					attribute.String(semconv.GenAIRequestModel, req.Model),
					attribute.String(semconv.ErrorType, errType),
				))
		}
	}()

	setRequestAttributes(span, req, c.baseURL)

	reqBody, err := json.Marshal(req)
	if err != nil {
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.chatCompletionsURL(), bytes.NewReader(reqBody))
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
	setResponseAttributes(span, &resp)

	attrs := []attribute.KeyValue{
		attribute.String(semconv.GenAISystem, semconv.GenAISystemMistral),
		attribute.String(semconv.GenAIProviderName, semconv.GenAISystemMistral),
		attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
		attribute.String(semconv.GenAIRequestModel, req.Model),
		attribute.String(semconv.GenAIResponseModel, resp.Model),
	}

	// Always record operation duration on success (even without usage).
	operationDurationHistogram.Record(ctx, duration.Seconds(), metric.WithAttributes(attrs...))

	if resp.Usage != nil {
		cost := helpers.CalculateGlobalCost(resp.Model, resp.Usage.PromptTokens, resp.Usage.CompletionTokens)
		semconv.SetFloat64Attribute(span, semconv.GenAIUsageCost, cost)

		tokenUsageHistogram.Record(ctx, int64(resp.Usage.PromptTokens),
			metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "input"))...))
		tokenUsageHistogram.Record(ctx, int64(resp.Usage.CompletionTokens),
			metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "output"))...))
		usageCostHistogram.Record(ctx, cost, metric.WithAttributes(attrs...))
	}

	emitInferenceEvent(span, req, resp.ID, resp.Model, resp.Usage, finishReasonsFromChoices(resp.Choices), c.baseURL)

	span.SetStatus(codes.Ok, "")
	return &resp, nil
}

func setRequestAttributes(span trace.Span, req ChatCompletionRequest, baseURL string) {
	semconv.SetStringAttribute(span, semconv.GenAIOperationName, semconv.GenAIOperationTypeChat)
	semconv.SetStringAttribute(span, semconv.GenAISystem, semconv.GenAISystemMistral)
	semconv.SetStringAttribute(span, semconv.GenAIProviderName, semconv.GenAISystemMistral)
	semconv.SetStringAttribute(span, semconv.GenAIRequestModel, req.Model)
	semconv.SetStringAttribute(span, semconv.OpenLITSDKVersion, openlit.Version)
	semconv.SetBoolAttribute(span, semconv.GenAIRequestIsStream, req.Stream)

	addr, port := helpers.SetServerAddressAndPort(baseURL, defaultServerAddress, defaultServerPort)
	semconv.SetStringAttribute(span, semconv.ServerAddress, addr)
	semconv.SetIntAttribute(span, semconv.ServerPort, port)

	if req.User != "" {
		semconv.SetStringAttribute(span, semconv.GenAIRequestUser, req.User)
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

	if helpers.GetCaptureMessageContent() {
		messages := make([]semconv.Message, 0, len(req.Messages))
		for _, msg := range req.Messages {
			messages = append(messages, semconv.Message{
				Role:    msg.Role,
				Content: msg.Content,
			})
		}
		if len(messages) > 0 {
			_ = semconv.SetMessagesAttribute(span, semconv.GenAIInputMessages, messages)
		}
	}

	if len(req.Tools) > 0 {
		tools := make([]semconv.ToolDefinition, len(req.Tools))
		for i, tool := range req.Tools {
			tools[i] = semconv.ToolDefinition{Type: tool.Type}
			if tools[i].Type == "" {
				tools[i].Type = "function"
			}
			tools[i].Function.Name = tool.Function.Name
			tools[i].Function.Description = tool.Function.Description
			tools[i].Function.Parameters = tool.Function.Parameters
		}
		_ = semconv.SetToolDefinitionsAttribute(span, semconv.GenAIToolDefinitions, tools)
	}
}

func setResponseAttributes(span trace.Span, resp *ChatCompletionResponse) {
	semconv.SetStringAttribute(span, semconv.GenAIResponseID, resp.ID)
	semconv.SetStringAttribute(span, semconv.GenAIResponseModel, resp.Model)
	semconv.SetStringAttribute(span, semconv.GenAIOutputType, semconv.GenAIOutputTypeText)

	if len(resp.Choices) > 0 {
		finishReasons := finishReasonsFromChoices(resp.Choices)
		if len(finishReasons) > 0 {
			semconv.SetStringSliceAttribute(span, semconv.GenAIResponseFinishReasons, finishReasons)
		}

		if len(resp.Choices[0].Message.ToolCalls) > 0 {
			setToolCallAttributes(span, resp.Choices[0].Message.ToolCalls)
		}

		if helpers.GetCaptureMessageContent() {
			outputMessages := make([]semconv.Message, 0, len(resp.Choices))
			for _, choice := range resp.Choices {
				outputMessages = append(outputMessages, semconv.Message{
					Role:    choice.Message.Role,
					Content: choice.Message.Content,
				})
			}
			_ = semconv.SetMessagesAttribute(span, semconv.GenAIOutputMessages, outputMessages)
		}
	}

	if resp.Usage != nil {
		semconv.SetIntAttribute(span, semconv.GenAIUsageInputTokens, resp.Usage.PromptTokens)
		semconv.SetIntAttribute(span, semconv.GenAIUsageOutputTokens, resp.Usage.CompletionTokens)
		semconv.SetIntAttribute(span, semconv.GenAIUsageTotalTokens, resp.Usage.TotalTokens)
	}
}

func setToolCallAttributes(span trace.Span, toolCalls []ToolCall) {
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

func finishReasonsFromChoices(choices []ChatCompletionChoice) []string {
	finishReasons := make([]string, 0, len(choices))
	for _, choice := range choices {
		if choice.FinishReason != "" {
			finishReasons = append(finishReasons, choice.FinishReason)
		}
	}
	return finishReasons
}

func emitInferenceEvent(span trace.Span, req ChatCompletionRequest, responseID, responseModel string, usage *Usage, finishReasons []string, baseURL string) {
	addr, port := helpers.SetServerAddressAndPort(baseURL, defaultServerAddress, defaultServerPort)
	attrs := []attribute.KeyValue{
		attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
		attribute.String(semconv.GenAISystem, semconv.GenAISystemMistral),
		attribute.String(semconv.GenAIProviderName, semconv.GenAISystemMistral),
		attribute.String(semconv.GenAIRequestModel, req.Model),
		attribute.String(semconv.GenAIResponseModel, responseModel),
		attribute.String(semconv.ServerAddress, addr),
		attribute.Int(semconv.ServerPort, port),
		attribute.String(semconv.GenAIOutputType, semconv.GenAIOutputTypeText),
		attribute.String(semconv.OpenLITSDKVersion, openlit.Version),
	}
	if responseID != "" {
		attrs = append(attrs, attribute.String(semconv.GenAIResponseID, responseID))
	}
	if len(finishReasons) > 0 {
		attrs = append(attrs, attribute.StringSlice(semconv.GenAIResponseFinishReasons, finishReasons))
	}
	if usage != nil {
		attrs = append(attrs,
			attribute.Int(semconv.GenAIUsageInputTokens, usage.PromptTokens),
			attribute.Int(semconv.GenAIUsageOutputTokens, usage.CompletionTokens),
			attribute.Int(semconv.GenAIUsageTotalTokens, usage.TotalTokens),
		)
	}
	helpers.EmitInferenceEvent(span, attrs)
}
