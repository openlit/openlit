package openai

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

// createChatCompletionStream handles streaming chat completions
func (c *InstrumentedClient) createChatCompletionStream(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionStream, error) {
	tracer := otel.Tracer("openlit.openai")

	spanName := fmt.Sprintf("%s %s", semconv.GenAIOperationTypeChat, req.Model)
	ctx, span := tracer.Start(ctx, spanName, trace.WithSpanKind(trace.SpanKindClient))

	req.Stream = true
	if req.StreamOptions == nil {
		req.StreamOptions = &StreamOptions{IncludeUsage: true}
	}

	setRequestAttributes(span, req)

	reqBody, err := json.Marshal(req)
	if err != nil {
		span.End()
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/chat/completions", bytes.NewReader(reqBody))
	if err != nil {
		span.End()
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Accept", "text/event-stream")

	httpResp, err := c.httpClient.Do(httpReq)
	if err != nil {
		span.End()
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}

	if httpResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(httpResp.Body)
		httpResp.Body.Close()
		span.End()
		err := fmt.Errorf("API error: %s - %s", httpResp.Status, string(body))
		helpers.RecordError(span, err)
		return nil, err
	}

	stream := &ChatCompletionStream{
		reader: make(chan ChatCompletionChunk, 10),
		body:   httpResp.Body,
		done:   false,
	}

	go c.readStream(ctx, span, httpResp.Body, stream, req)

	return stream, nil
}

// readStream reads the SSE stream and sends chunks to the channel
func (c *InstrumentedClient) readStream(ctx context.Context, span trace.Span, body io.ReadCloser, stream *ChatCompletionStream, req ChatCompletionRequest) {
	defer body.Close()
	defer close(stream.reader)
	defer span.End()

	meter := otel.Meter("openlit.openai")
	tokenUsageHistogram, _ := meter.Int64Histogram(semconv.GenAIClientTokenUsage,
		metric.WithDescription("Number of tokens used in GenAI operations"),
		metric.WithUnit("{token}"))
	operationDurationHistogram, _ := meter.Float64Histogram(semconv.GenAIClientOperationDuration,
		metric.WithDescription("Duration of GenAI operations"),
		metric.WithUnit("s"))
	timeToFirstTokenHistogram, _ := meter.Float64Histogram(semconv.GenAIServerTimeToFirstToken,
		metric.WithDescription("Time to first token in streaming responses"),
		metric.WithUnit("s"))
	timePerOutputTokenHistogram, _ := meter.Float64Histogram(semconv.GenAIServerTimePerOutputToken,
		metric.WithDescription("Average time between output tokens in streaming responses"),
		metric.WithUnit("s"))
	clientTimeToFirstChunkHistogram, _ := meter.Float64Histogram(semconv.GenAIClientOperationTimeToFirstChunk,
		metric.WithDescription("Client-side time to first chunk in streaming responses"),
		metric.WithUnit("s"))
	clientTimePerOutputChunkHistogram, _ := meter.Float64Histogram(semconv.GenAIClientOperationTimePerOutputChunk,
		metric.WithDescription("Per-chunk output token latency observations in streaming responses"),
		metric.WithUnit("s"))
	serverRequestDurationHistogram, _ := meter.Float64Histogram(semconv.GenAIServerRequestDuration,
		metric.WithDescription("Estimated server-side request processing duration"),
		metric.WithUnit("s"))

	scanner := bufio.NewScanner(body)
	startTime := time.Now()
	firstTokenTime := time.Duration(0)
	var tokenTimestamps []time.Time
	var lastChunk *ChatCompletionChunk
	accumulatedContent := ""
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

		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			now := time.Now()
			if firstTokenTime == 0 {
				firstTokenTime = now.Sub(startTime)
			}
			tokenTimestamps = append(tokenTimestamps, now)
			accumulatedContent += chunk.Choices[0].Delta.Content
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

	if lastChunk != nil {
		semconv.SetStringAttribute(span, semconv.GenAIResponseID, lastChunk.ID)
		semconv.SetStringAttribute(span, semconv.GenAIResponseModel, lastChunk.Model)

		if lastChunk.SystemFingerprint != "" {
			semconv.SetStringAttribute(span, semconv.GenAIOpenAIResponseSystemFingerprint, lastChunk.SystemFingerprint)
		}
		if lastChunk.ServiceTier != "" {
			semconv.SetStringAttribute(span, semconv.GenAIOpenAIResponseServiceTier, lastChunk.ServiceTier)
		}

		if lastChunk.Usage != nil {
			semconv.SetIntAttribute(span, semconv.GenAIUsageInputTokens, lastChunk.Usage.PromptTokens)
			semconv.SetIntAttribute(span, semconv.GenAIUsageOutputTokens, lastChunk.Usage.CompletionTokens)
			semconv.SetIntAttribute(span, semconv.GenAIUsageTotalTokens, lastChunk.Usage.TotalTokens)

			cost := helpers.CalculateGlobalCost(lastChunk.Model, lastChunk.Usage.PromptTokens, lastChunk.Usage.CompletionTokens)
			semconv.SetFloat64Attribute(span, semconv.GenAIUsageCost, cost)

			// Record OTel metrics
			attrs := []attribute.KeyValue{
				attribute.String(semconv.GenAISystem, semconv.GenAISystemOpenAI),
				attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
				attribute.String(semconv.GenAIRequestModel, req.Model),
				attribute.String(semconv.GenAIResponseModel, lastChunk.Model),
			}
			tokenUsageHistogram.Record(ctx, int64(lastChunk.Usage.PromptTokens),
				metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "input"))...))
			tokenUsageHistogram.Record(ctx, int64(lastChunk.Usage.CompletionTokens),
				metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "output"))...))
			operationDurationHistogram.Record(ctx, duration.Seconds(), metric.WithAttributes(attrs...))
		}

		if len(lastChunk.Choices) > 0 {
			finishReasons := make([]string, 0, len(lastChunk.Choices))
			for _, choice := range lastChunk.Choices {
				if choice.FinishReason != "" {
					finishReasons = append(finishReasons, choice.FinishReason)
				}
			}
			if len(finishReasons) > 0 {
				semconv.SetStringSliceAttribute(span, semconv.GenAIResponseFinishReasons, finishReasons)
			}
		}
	}

	// TTFT — set as span attribute and record histogram metrics
	if firstTokenTime > 0 {
		semconv.SetFloat64Attribute(span, semconv.GenAIServerTimeToFirstToken, firstTokenTime.Seconds())
		ttftAttrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemOpenAI),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		}
		timeToFirstTokenHistogram.Record(ctx, firstTokenTime.Seconds(), metric.WithAttributes(ttftAttrs...))
		clientTtfcAttrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemOpenAI),
			attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		}
		clientTimeToFirstChunkHistogram.Record(ctx, firstTokenTime.Seconds(), metric.WithAttributes(clientTtfcAttrs...))
	}

	// TBT (time between tokens) — average inter-token latency + per-chunk observations
	if len(tokenTimestamps) > 1 {
		total := time.Duration(0)
		chunkAttrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemOpenAI),
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
		tbtAttrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemOpenAI),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		}
		timePerOutputTokenHistogram.Record(ctx, tbtSeconds, metric.WithAttributes(tbtAttrs...))
	}

	// Server request duration (estimated: TTFT + TBT_avg × (output_tokens - 1))
	if firstTokenTime > 0 {
		outputTokenCount := 0
		if lastChunk != nil && lastChunk.Usage != nil {
			outputTokenCount = lastChunk.Usage.CompletionTokens
		}
		if outputTokenCount == 0 {
			outputTokenCount = len(tokenTimestamps)
		}
		serverDur := firstTokenTime.Seconds()
		if tbtSeconds > 0 && outputTokenCount > 1 {
			serverDur += tbtSeconds * float64(outputTokenCount-1)
		}
		serverAttrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemOpenAI),
			attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		}
		serverRequestDurationHistogram.Record(ctx, serverDur, metric.WithAttributes(serverAttrs...))
	}

	if helpers.GetCaptureMessageContent() && accumulatedContent != "" {
		semconv.SetStringAttribute(span, semconv.GenAICompletion, accumulatedContent)
	}

	span.SetStatus(codes.Ok, "")
	stream.done = true
}
