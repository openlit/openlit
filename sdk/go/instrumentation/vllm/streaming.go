package vllm

import (
	"bufio"
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
	// Large enough for long SSE JSON payloads (tool calls, long content).
	sseScannerBufferSize = 1024 * 1024 // 1 MiB
)

// createChatCompletionStream handles streaming chat completions
func (c *InstrumentedClient) createChatCompletionStream(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionStream, error) {
	ensureMetrics()

	if req.Model == "" {
		req.Model = defaultModel
	}

	tracer := c.tracer
	if tracer == nil {
		tracer = otel.Tracer("openlit.vllm")
	}

	spanName := fmt.Sprintf("%s %s", semconv.GenAIOperationTypeChat, req.Model)
	ctx, span := tracer.Start(ctx, spanName, trace.WithSpanKind(trace.SpanKindClient))

	req.Stream = true
	if req.StreamOptions == nil {
		req.StreamOptions = &StreamOptions{IncludeUsage: true}
	}

	setRequestAttributes(span, req, c.baseURL)

	reqBody, err := json.Marshal(req)
	if err != nil {
		helpers.RecordError(span, err)
		span.End()
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.chatCompletionsURL(), bytes.NewReader(reqBody))
	if err != nil {
		helpers.RecordError(span, err)
		span.End()
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	if c.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	httpResp, err := c.httpClient.Do(httpReq)
	if err != nil {
		helpers.RecordError(span, err)
		span.End()
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}

	if httpResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(httpResp.Body)
		_ = httpResp.Body.Close()
		apiErr := fmt.Errorf("API error: %s - %s", httpResp.Status, string(body))
		helpers.RecordError(span, apiErr)
		span.End()
		return nil, apiErr
	}

	stream := &ChatCompletionStream{
		reader: make(chan ChatCompletionChunk, 10),
		body:   httpResp.Body,
		done:   false,
	}

	go c.readStream(ctx, span, stream, req)

	return stream, nil
}

// readStream reads the SSE stream and sends chunks to the channel
func (c *InstrumentedClient) readStream(ctx context.Context, span trace.Span, stream *ChatCompletionStream, req ChatCompletionRequest) {
	defer stream.Close() //nolint:errcheck
	defer close(stream.reader)
	defer span.End()

	scanner := bufio.NewScanner(stream.body)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, sseScannerBufferSize)

	startTime := time.Now()
	firstTokenTime := time.Duration(0)
	var tokenTimestamps []time.Time
	var lastChunk *ChatCompletionChunk
	var lastUsage *Usage
	responseID := ""
	responseModel := ""
	accumulatedContent := ""
	var finishReasons []string
	var streamedToolCalls []ToolCall
	var tbtSeconds float64

	for scanner.Scan() {
		line := scanner.Text()

		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk ChatCompletionChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			stream.err = fmt.Errorf("failed to parse chunk: %w", err)
			helpers.RecordError(span, err)
			return
		}

		if chunk.ID != "" {
			responseID = chunk.ID
		}
		if chunk.Model != "" {
			responseModel = chunk.Model
		}
		if chunk.Usage != nil {
			lastUsage = chunk.Usage
		}

		for _, choice := range chunk.Choices {
			if choice.FinishReason != "" {
				finishReasons = append(finishReasons, choice.FinishReason)
			}
			if choice.Delta.Content != "" {
				now := time.Now()
				if firstTokenTime == 0 {
					firstTokenTime = now.Sub(startTime)
				}
				tokenTimestamps = append(tokenTimestamps, now)
				accumulatedContent += choice.Delta.Content
			}
			if len(choice.Delta.ToolCalls) > 0 {
				streamedToolCalls = append(streamedToolCalls, choice.Delta.ToolCalls...)
			}
		}

		lastChunk = &chunk

		select {
		case stream.reader <- chunk:
		case <-ctx.Done():
			stream.err = ctx.Err()
			helpers.RecordError(span, ctx.Err())
			return
		}
	}

	if err := scanner.Err(); err != nil {
		stream.err = fmt.Errorf("scanner error: %w", err)
		helpers.RecordError(span, err)
		return
	}

	duration := time.Since(startTime)

	if responseID != "" {
		semconv.SetStringAttribute(span, semconv.GenAIResponseID, responseID)
	}
	if responseModel != "" {
		semconv.SetStringAttribute(span, semconv.GenAIResponseModel, responseModel)
	}
	semconv.SetStringAttribute(span, semconv.GenAIOutputType, semconv.GenAIOutputTypeText)

	if len(finishReasons) > 0 {
		semconv.SetStringSliceAttribute(span, semconv.GenAIResponseFinishReasons, finishReasons)
	}
	if len(streamedToolCalls) > 0 {
		setToolCallAttributes(span, streamedToolCalls)
	}

	attrs := []attribute.KeyValue{
		attribute.String(semconv.GenAISystem, semconv.GenAISystemVLLM),
		attribute.String(semconv.GenAIProviderName, semconv.GenAISystemVLLM),
		attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
		attribute.String(semconv.GenAIRequestModel, req.Model),
		attribute.String(semconv.GenAIResponseModel, responseModel),
	}

	operationDurationHistogram.Record(ctx, duration.Seconds(), metric.WithAttributes(attrs...))

	if lastUsage != nil {
		semconv.SetIntAttribute(span, semconv.GenAIUsageInputTokens, lastUsage.PromptTokens)
		semconv.SetIntAttribute(span, semconv.GenAIUsageOutputTokens, lastUsage.CompletionTokens)
		semconv.SetIntAttribute(span, semconv.GenAIUsageTotalTokens, lastUsage.TotalTokens)

		costModel := responseModel
		if costModel == "" && lastChunk != nil {
			costModel = lastChunk.Model
		}
		cost := helpers.CalculateGlobalCost(costModel, lastUsage.PromptTokens, lastUsage.CompletionTokens)
		semconv.SetFloat64Attribute(span, semconv.GenAIUsageCost, cost)

		tokenUsageHistogram.Record(ctx, int64(lastUsage.PromptTokens),
			metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "input"))...))
		tokenUsageHistogram.Record(ctx, int64(lastUsage.CompletionTokens),
			metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "output"))...))
		usageCostHistogram.Record(ctx, cost, metric.WithAttributes(attrs...))
	}

	// TTFT
	if firstTokenTime > 0 {
		semconv.SetFloat64Attribute(span, semconv.GenAIServerTimeToFirstToken, firstTokenTime.Seconds())
		ttftAttrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemVLLM),
			attribute.String(semconv.GenAIProviderName, semconv.GenAISystemVLLM),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		}
		timeToFirstTokenHistogram.Record(ctx, firstTokenTime.Seconds(), metric.WithAttributes(ttftAttrs...))
		clientTimeToFirstChunkHistogram.Record(ctx, firstTokenTime.Seconds(), metric.WithAttributes(
			attribute.String(semconv.GenAISystem, semconv.GenAISystemVLLM),
			attribute.String(semconv.GenAIProviderName, semconv.GenAISystemVLLM),
			attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		))
	}

	// TBT
	if len(tokenTimestamps) > 1 {
		total := time.Duration(0)
		chunkAttrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemVLLM),
			attribute.String(semconv.GenAIProviderName, semconv.GenAISystemVLLM),
			attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		}
		for i := 1; i < len(tokenTimestamps); i++ {
			dur := tokenTimestamps[i].Sub(tokenTimestamps[i-1])
			total += dur
			clientTimePerOutputChunkHistogram.Record(ctx, dur.Seconds(), metric.WithAttributes(chunkAttrs...))
		}
		tbt := total / time.Duration(len(tokenTimestamps)-1)
		tbtSeconds = tbt.Seconds()
		semconv.SetFloat64Attribute(span, semconv.GenAIServerTimePerOutputToken, tbtSeconds)
		timePerOutputTokenHistogram.Record(ctx, tbtSeconds, metric.WithAttributes(
			attribute.String(semconv.GenAISystem, semconv.GenAISystemVLLM),
			attribute.String(semconv.GenAIProviderName, semconv.GenAISystemVLLM),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		))
	}

	// Server request duration estimate
	if firstTokenTime > 0 {
		outputTokenCount := 0
		if lastUsage != nil {
			outputTokenCount = lastUsage.CompletionTokens
		}
		if outputTokenCount == 0 {
			outputTokenCount = len(tokenTimestamps)
		}
		serverDur := firstTokenTime.Seconds()
		if tbtSeconds > 0 && outputTokenCount > 1 {
			serverDur += tbtSeconds * float64(outputTokenCount-1)
		}
		serverRequestDurationHistogram.Record(ctx, serverDur, metric.WithAttributes(
			attribute.String(semconv.GenAISystem, semconv.GenAISystemVLLM),
			attribute.String(semconv.GenAIProviderName, semconv.GenAISystemVLLM),
			attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		))
	}

	if helpers.GetCaptureMessageContent() && accumulatedContent != "" {
		_ = semconv.SetMessagesAttribute(span, semconv.GenAIOutputMessages, []semconv.Message{{
			Role:    "assistant",
			Content: accumulatedContent,
		}})
	}

	emitInferenceEvent(span, req, responseID, responseModel, lastUsage, finishReasons, c.baseURL)

	span.SetStatus(codes.Ok, "")
	stream.done = true
}
