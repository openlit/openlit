// metrics.go — coding-agent OTel metrics, emitted alongside the
// matching spans so backends that consume metrics see the same
// numbers traces backends see.
//
// We always emit these counters, regardless of content-capture mode:
//
//   - `coding_agent.lines_of_code.count` — added / removed lines,
//     tagged with type=added|removed, decision (accept/reject/auto),
//     vendor, user.
//   - `coding_agent.code_edit_tool.decision` — count of edit
//     decisions, tagged with decision, vendor, tool_name, language,
//     user.
//   - `coding_agent.commit.count` — agent-attributed git commits,
//     tagged with vendor, user.
//   - `coding_agent.pull_request.count` — agent-attributed pull/merge
//     requests, tagged with vendor, user.
//
// The instruments are package-level so they survive the lifetime of
// the in-process MeterProvider (one per hook invocation). Lazily
// initialised on first use so a `NewEmitter` failure path that never
// calls Init still leaves them as nil and the Record* helpers no-op.
package otlp

import (
	"context"
	"sync"

	"github.com/openlit/openlit/sdk/go/semconv"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var (
	meterOnce       sync.Once
	linesOfCodeCnt  metric.Int64Counter
	editDecisionCnt metric.Int64Counter
	commitCnt       metric.Int64Counter
	pullRequestCnt  metric.Int64Counter
)

// initMetrics initialises the coding-agent metric instruments on
// first use. The function is safe to call repeatedly; only the first
// call does any work. Returns silently on instrument-creation
// failure — the helpers downstream all guard against a nil counter.
func initMetrics() {
	meterOnce.Do(func() {
		m := otel.GetMeterProvider().Meter("openlit-cli/coding_agent")
		var err error
		if linesOfCodeCnt, err = m.Int64Counter(
			semconv.CodingAgentMetricLinesOfCode,
			metric.WithDescription("Lines of code added or removed by a coding-agent edit, grouped by accept/reject decision."),
			metric.WithUnit("{line}"),
		); err != nil {
			linesOfCodeCnt = nil
		}
		if editDecisionCnt, err = m.Int64Counter(
			semconv.CodingAgentMetricEditDecisionCnt,
			metric.WithDescription("Count of coding-agent edit decisions, by accept/reject/modify."),
			metric.WithUnit("{decision}"),
		); err != nil {
			editDecisionCnt = nil
		}
		if commitCnt, err = m.Int64Counter(
			semconv.CodingAgentMetricCommit,
			metric.WithDescription("Count of agent-attributed git commits."),
			metric.WithUnit("{commit}"),
		); err != nil {
			commitCnt = nil
		}
		if pullRequestCnt, err = m.Int64Counter(
			semconv.CodingAgentMetricPullRequest,
			metric.WithDescription("Count of agent-attributed pull/merge requests."),
			metric.WithUnit("{pull_request}"),
		); err != nil {
			pullRequestCnt = nil
		}
	})
}

// commonAttrs builds the standard set of attribute tags used on the
// commit / PR counters. We deliberately keep the cardinality low —
// only vendor + user. Per-session tags would explode metric series.
func commonAttrs(vendor, user string) []attribute.KeyValue {
	out := make([]attribute.KeyValue, 0, 2)
	if vendor != "" {
		out = append(out, attribute.String(semconv.CodingAgentClient, vendor))
	}
	if user != "" {
		out = append(out, attribute.String(semconv.GenAIRequestUser, user))
	}
	return out
}

// recordLines bumps `coding_agent.lines_of_code.count` once for added
// and once for removed (so backends can sum / split via the `type`
// tag). Decision identifies whether the change landed (accept /
// auto_accepted) or didn't (reject) so the resulting metric series
// can drive the "acceptance %" dashboard widget.
func recordLines(vendor, user, decision string, added, removed int) {
	initMetrics()
	if linesOfCodeCnt == nil {
		return
	}
	if added == 0 && removed == 0 {
		return
	}
	ctx := context.Background()
	base := commonAttrs(vendor, user)
	if decision != "" {
		base = append(base, attribute.String(semconv.CodingAgentEditDecision, decision))
	}
	if added > 0 {
		linesOfCodeCnt.Add(ctx, int64(added), metric.WithAttributes(append(base, attribute.String("type", "added"))...))
	}
	if removed > 0 {
		linesOfCodeCnt.Add(ctx, int64(removed), metric.WithAttributes(append(base, attribute.String("type", "removed"))...))
	}
}

// recordEditDecision bumps `coding_agent.code_edit_tool.decision` by
// one. tool / language are best-effort tags.
func recordEditDecision(vendor, user, decision, tool, language string) {
	initMetrics()
	if editDecisionCnt == nil {
		return
	}
	if decision == "" {
		return
	}
	ctx := context.Background()
	attrs := commonAttrs(vendor, user)
	attrs = append(attrs, attribute.String(semconv.CodingAgentEditDecision, decision))
	if tool != "" {
		attrs = append(attrs, attribute.String(semconv.CodingAgentEditToolName, tool))
	}
	if language != "" {
		attrs = append(attrs, attribute.String(semconv.CodingAgentEditLanguage, language))
	}
	editDecisionCnt.Add(ctx, 1, metric.WithAttributes(attrs...))
}

// recordCommit bumps `coding_agent.commit.count` by one.
func recordCommit(vendor, user string) {
	initMetrics()
	if commitCnt == nil {
		return
	}
	commitCnt.Add(context.Background(), 1, metric.WithAttributes(commonAttrs(vendor, user)...))
}

// recordPullRequest bumps `coding_agent.pull_request.count` by one.
func recordPullRequest(vendor, user string) {
	initMetrics()
	if pullRequestCnt == nil {
		return
	}
	pullRequestCnt.Add(context.Background(), 1, metric.WithAttributes(commonAttrs(vendor, user)...))
}
