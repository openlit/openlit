// Head sampling for the coding-agent hook pipeline. Wires into the
// SDK via openlit.Config.Sampler.
//
// Beta default (used when OPENLIT_CODING_SAMPLE_EVENTS is unset): keep
// everything. Operators with high-volume hosts can drop the noisy
// "*.requested" events while keeping session bookends, tool.call, and
// llm.turn — the spans dashboards actually read.
//
// Set OPENLIT_CODING_SAMPLE_EVENTS=drop_requested to enable the
// pre-canned policy. Future modes can extend the switch below
// without changing call sites.

package otlp

import (
	"os"
	"strings"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// sampleEventsEnv controls which head sampling policy the hook uses.
// We intentionally read it once at sampler construction time so the
// value is stable for the lifetime of the hook process.
const sampleEventsEnv = "OPENLIT_CODING_SAMPLE_EVENTS"

// defaultSampler returns the sampler the hook should plug into the
// SDK. Returns nil to mean "let the SDK pick its default
// (AlwaysSample)" so the beta posture stays unchanged for ops who
// haven't opted in.
func defaultSampler() sdktrace.Sampler {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv(sampleEventsEnv)))
	switch mode {
	case "", "all", "always_on":
		return nil
	case "drop_requested":
		// Drop the per-tool/per-shell "requested" events but keep
		// every other span. These events fire once per pending tool
		// invocation and are pure noise for cost / outcome
		// dashboards — yet on a chatty session they account for
		// roughly 1/3 of all spans.
		return spanNameSampler{
			drop: map[string]struct{}{
				"coding_agent.tool.requested":     {},
				"coding_agent.shell.requested":    {},
				"coding_agent.mcp.tool.requested": {},
				"coding_agent.user_prompt.submit": {},
			},
		}
	default:
		// Unknown values fall back to AlwaysSample; we never want
		// a typo in an env var to silently drop telemetry.
		return nil
	}
}

// spanNameSampler is a head sampler that drops spans whose name is
// in `drop` and keeps everything else. Faster than the OTel
// composite samplers for our very small drop list, and easier to
// reason about than ParentBased.
type spanNameSampler struct {
	drop map[string]struct{}
}

func (s spanNameSampler) ShouldSample(p sdktrace.SamplingParameters) sdktrace.SamplingResult {
	if _, drop := s.drop[p.Name]; drop {
		return sdktrace.SamplingResult{
			Decision:   sdktrace.Drop,
			Tracestate: trace.SpanContextFromContext(p.ParentContext).TraceState(),
		}
	}
	return sdktrace.SamplingResult{
		Decision:   sdktrace.RecordAndSample,
		Tracestate: trace.SpanContextFromContext(p.ParentContext).TraceState(),
	}
}

func (s spanNameSampler) Description() string {
	return "openlit.coding_agent.span_name_sampler"
}
