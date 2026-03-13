package anthropic

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

// createMessageStream handles streaming message requests
func (c *InstrumentedClient) createMessageStream(ctx context.Context, req MessageRequest) (*MessageStream, error) {
	tracer := otel.Tracer("openlit.anthropic")

	spanName := fmt.Sprintf("%s %s", semconv.GenAIOperationTypeChat, req.Model)
	ctx, span := tracer.Start(ctx, spanName, trace.WithSpanKind(trace.SpanKindClient))

	req.Stream = true

	setRequestAttributes(span, req)

	reqBody, err := json.Marshal(req)
	if err != nil {
		span.End()
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/messages", bytes.NewReader(reqBody))
	if err != nil {
		span.End()
		helpers.RecordError(span, err)
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.apiKey)
	httpReq.Header.Set("anthropic-version", c.apiVersion)
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

	stream := &MessageStream{
		reader: make(chan MessageStreamEvent, 10),
		body:   httpResp.Body,
		done:   false,
	}

	go c.readStream(ctx, span, httpResp.Body, stream, req)

	return stream, nil
}

// readStream reads the SSE stream and sends events to the channel
func (c *InstrumentedClient) readStream(ctx context.Context, span trace.Span, body io.ReadCloser, stream *MessageStream, req MessageRequest) {
	defer body.Close()
	defer close(stream.reader)
	defer span.End()

	meter := otel.Meter("openlit.anthropic")
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
	accumulatedContent := ""
	var tbtSeconds float64

	var messageID string
	var messageModel string
	var stopReason string
	var inputTokens, outputTokens int

	for scanner.Scan() {
		line := scanner.Text()

		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}

		if !strings.HasPrefix(line, "event: ") && !strings.HasPrefix(line, "data: ") {
			continue
		}

		var eventData string

		if strings.HasPrefix(line, "event: ") {
			// Read next line for data
			if scanner.Scan() {
				dataLine := scanner.Text()
				if strings.HasPrefix(dataLine, "data: ") {
					eventData = strings.TrimPrefix(dataLine, "data: ")
				}
			}
		} else if strings.HasPrefix(line, "data: ") {
			eventData = strings.TrimPrefix(line, "data: ")
		}

		if eventData == "" {
			continue
		}

		var event MessageStreamEvent
		if err := json.Unmarshal([]byte(eventData), &event); err != nil {
			stream.err = fmt.Errorf("failed to parse event: %w", err)
			helpers.RecordError(span, err)
			return
		}

		switch event.Type {
		case "message_start":
			if event.Message != nil {
				messageID = event.Message.ID
				messageModel = event.Message.Model
				if event.Message.Usage != nil {
					inputTokens = event.Message.Usage.InputTokens
				}
			}

		case "content_block_delta":
			if event.Delta != nil && event.Delta.Text != "" {
				now := time.Now()
				if firstTokenTime == 0 {
					firstTokenTime = now.Sub(startTime)
				}
				tokenTimestamps = append(tokenTimestamps, now)
				accumulatedContent += event.Delta.Text
			}

		case "message_delta":
			if event.Delta != nil && event.Delta.StopReason != "" {
				stopReason = event.Delta.StopReason
			}
			if event.Usage != nil {
				outputTokens = event.Usage.OutputTokens
			}
		}

		select {
		case stream.reader <- event:
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

	// Use request model as fallback if stream didn't send model info
	if messageModel == "" {
		messageModel = req.Model
	}

	semconv.SetStringAttribute(span, semconv.GenAIResponseID, messageID)
	semconv.SetStringAttribute(span, semconv.GenAIResponseModel, messageModel)

	if stopReason != "" {
		semconv.SetStringSliceAttribute(span, semconv.GenAIResponseFinishReasons, []string{stopReason})
	}

	if inputTokens > 0 || outputTokens > 0 {
		semconv.SetIntAttribute(span, semconv.GenAIUsageInputTokens, inputTokens)
		semconv.SetIntAttribute(span, semconv.GenAIUsageOutputTokens, outputTokens)
		semconv.SetIntAttribute(span, semconv.GenAIUsageTotalTokens, inputTokens+outputTokens)

		cost := helpers.CalculateGlobalCost(messageModel, inputTokens, outputTokens)
		semconv.SetFloat64Attribute(span, semconv.GenAIUsageCost, cost)

		// Record OTel metrics
		attrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemAnthropic),
			attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
			attribute.String(semconv.GenAIRequestModel, req.Model),
			attribute.String(semconv.GenAIResponseModel, messageModel),
		}
		tokenUsageHistogram.Record(ctx, int64(inputTokens),
			metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "input"))...))
		tokenUsageHistogram.Record(ctx, int64(outputTokens),
			metric.WithAttributes(append(attrs, attribute.String(semconv.GenAITokenType, "output"))...))
		operationDurationHistogram.Record(ctx, duration.Seconds(), metric.WithAttributes(attrs...))
	}

	// TTFT — set as span attribute and record histogram metrics
	if firstTokenTime > 0 {
		semconv.SetFloat64Attribute(span, semconv.GenAIServerTimeToFirstToken, firstTokenTime.Seconds())
		ttftAttrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemAnthropic),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		}
		timeToFirstTokenHistogram.Record(ctx, firstTokenTime.Seconds(), metric.WithAttributes(ttftAttrs...))
		clientTtfcAttrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemAnthropic),
			attribute.String(semconv.GenAIOperationName, semconv.GenAIOperationTypeChat),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		}
		clientTimeToFirstChunkHistogram.Record(ctx, firstTokenTime.Seconds(), metric.WithAttributes(clientTtfcAttrs...))
	}

	// TBT (time between tokens) — average inter-token latency + per-chunk observations
	if len(tokenTimestamps) > 1 {
		total := time.Duration(0)
		chunkAttrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemAnthropic),
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
			attribute.String(semconv.GenAISystem, semconv.GenAISystemAnthropic),
			attribute.String(semconv.GenAIRequestModel, req.Model),
		}
		timePerOutputTokenHistogram.Record(ctx, tbtSeconds, metric.WithAttributes(tbtAttrs...))
	}

	// Server request duration (estimated: TTFT + TBT_avg × (output_tokens - 1))
	if firstTokenTime > 0 {
		outputTokenCount := 0
		if outputTokens > 0 {
			outputTokenCount = outputTokens
		} else {
			outputTokenCount = len(tokenTimestamps)
		}
		serverDur := firstTokenTime.Seconds()
		if tbtSeconds > 0 && outputTokenCount > 1 {
			serverDur += tbtSeconds * float64(outputTokenCount-1)
		}
		serverAttrs := []attribute.KeyValue{
			attribute.String(semconv.GenAISystem, semconv.GenAISystemAnthropic),
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
