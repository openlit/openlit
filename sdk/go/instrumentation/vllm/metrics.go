package vllm

import (
	"sync"

	"github.com/openlit/openlit/sdk/go/semconv"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
)

// Package-level instruments so histograms are created once (Python/TS parity),
// not on every request.
var (
	metricsOnce sync.Once

	tokenUsageHistogram               metric.Int64Histogram
	operationDurationHistogram        metric.Float64Histogram
	timeToFirstTokenHistogram         metric.Float64Histogram
	timePerOutputTokenHistogram       metric.Float64Histogram
	clientTimeToFirstChunkHistogram   metric.Float64Histogram
	clientTimePerOutputChunkHistogram metric.Float64Histogram
	serverRequestDurationHistogram    metric.Float64Histogram
	usageCostHistogram                metric.Float64Histogram
)

func ensureMetrics() {
	metricsOnce.Do(func() {
		meter := otel.Meter("openlit.vllm")

		tokenUsageHistogram, _ = meter.Int64Histogram(semconv.GenAIClientTokenUsage,
			metric.WithDescription("Number of tokens used in GenAI operations"),
			metric.WithUnit("{token}"))
		operationDurationHistogram, _ = meter.Float64Histogram(semconv.GenAIClientOperationDuration,
			metric.WithDescription("Duration of GenAI operations"),
			metric.WithUnit("s"))
		timeToFirstTokenHistogram, _ = meter.Float64Histogram(semconv.GenAIServerTimeToFirstToken,
			metric.WithDescription("Time to first token in streaming responses"),
			metric.WithUnit("s"))
		timePerOutputTokenHistogram, _ = meter.Float64Histogram(semconv.GenAIServerTimePerOutputToken,
			metric.WithDescription("Average time between output tokens"),
			metric.WithUnit("s"))
		clientTimeToFirstChunkHistogram, _ = meter.Float64Histogram(semconv.GenAIClientOperationTimeToFirstChunk,
			metric.WithDescription("Client-side time to first chunk in streaming responses"),
			metric.WithUnit("s"))
		clientTimePerOutputChunkHistogram, _ = meter.Float64Histogram(semconv.GenAIClientOperationTimePerOutputChunk,
			metric.WithDescription("Per-chunk output token latency observations"),
			metric.WithUnit("s"))
		serverRequestDurationHistogram, _ = meter.Float64Histogram(semconv.GenAIServerRequestDuration,
			metric.WithDescription("Estimated server-side request processing duration"),
			metric.WithUnit("s"))
		usageCostHistogram, _ = meter.Float64Histogram(semconv.GenAIUsageCost,
			metric.WithDescription("Estimated cost of GenAI operations"),
			metric.WithUnit("USD"))
	})
}
