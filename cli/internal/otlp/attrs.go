// Helpers that translate normalize.* values into OTel attributes. Kept
// in their own file so exporter.go stays small.
//
// Every string-typed attribute funnels through the supplied scrub
// function (a no-op-friendly closure from internal/redact). Numeric and
// boolean attributes go through unscrubbed since they can't carry
// secrets in any meaningful way.

package otlp

import (
	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/sdk/go/semconv"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// scrubFn is the redactor signature emitter passes around. Equivalent
// to internal/redact.ForCapture's return type but redeclared locally so
// this file doesn't depend on the redact package.
type scrubFn func(string) string

func setSessionAttrs(span trace.Span, s normalize.Session, scrub scrubFn) {
	span.SetAttributes(
		attribute.String(semconv.CodingAgentHookSchemaVersion, semconv.CodingAgentSchemaVersion),
	)
	setStr(span, semconv.CodingAgentSessionID, s.SessionID, scrub)
	setStr(span, semconv.GenAIConversationID, s.ConversationID, scrub)
	if s.Vendor != "" {
		setStr(span, semconv.CodingAgentClient, s.Vendor, scrub)
		setStr(span, "gen_ai.agent.name", s.Vendor, scrub)
	}
	setStr(span, semconv.CodingAgentClientVersion, s.ClientVersion, scrub)

	if s.Model != "" {
		setStr(span, semconv.GenAIRequestModel, s.Model, scrub)
		setStr(span, semconv.GenAIResponseModel, s.Model, scrub)
	}
	if s.Provider != "" {
		setStr(span, semconv.GenAISystem, s.Provider, scrub)
	}

	setStr(span, semconv.CodingAgentSessionOutcome, s.Outcome, scrub)
	if s.Duration > 0 {
		span.SetAttributes(attribute.Int64(
			semconv.CodingAgentSessionDurationMs, s.Duration.Milliseconds(),
		))
	}
	if s.ToolCallCount > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentSessionToolCallCount, s.ToolCallCount))
	}
	if s.SubagentCount > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentSessionSubagentCount, s.SubagentCount))
	}
	if s.CostUSD > 0 {
		span.SetAttributes(attribute.Float64(semconv.CodingAgentSessionCostUSD, s.CostUSD))
		span.SetAttributes(attribute.Float64(semconv.GenAIUsageCost, s.CostUSD))
	}
	if s.InputTokens > 0 {
		span.SetAttributes(attribute.Int64(semconv.GenAIUsageInputTokens, s.InputTokens))
	}
	if s.OutputTokens > 0 {
		span.SetAttributes(attribute.Int64(semconv.GenAIUsageOutputTokens, s.OutputTokens))
	}
	if s.TotalTokens > 0 {
		span.SetAttributes(attribute.Int64(semconv.GenAIUsageTotalTokens, s.TotalTokens))
	}

	// VCS bridging — use OTel-standard vcs.* keys for the values that
	// have standard equivalents, plus our own coding_agent.vcs.dirty
	// boolean for the v1 metric.
	setStr(span, "vcs.repository.url.full", s.RepoURL, scrub)
	setStr(span, "vcs.ref.head.revision", s.HeadSHA, scrub)
	setStr(span, "vcs.ref.head.name", s.BranchName, scrub)
	if s.HeadSHA != "" {
		// Boolean is stamped only when we have any VCS context at all,
		// otherwise dashboards would see a column of `false` from
		// invocations outside any repo.
		span.SetAttributes(attribute.Bool(semconv.CodingAgentVCSDirty, s.VCSDirty))
	}

	// Identity / classification.
	if s.UserID != "" {
		setStr(span, semconv.GenAIRequestUser, s.UserID, scrub)
	}
	setStr(span, semconv.CodingAgentUserClassification, s.UserClassification, scrub)
	setStr(span, semconv.CodingAgentUserClassificationReason, s.ClassificationReason, scrub)
	setStr(span, semconv.CodingAgentPolicyPermissionMode, s.PermissionMode, scrub)

	for k, v := range s.Extras {
		setStr(span, k, v, scrub)
	}
}

func setToolCallAttrs(span trace.Span, t normalize.ToolCall, scrub scrubFn) {
	span.SetAttributes(attribute.String(semconv.CodingAgentHookSchemaVersion, semconv.CodingAgentSchemaVersion))
	setStr(span, semconv.CodingAgentSessionID, t.SessionID, scrub)
	setStr(span, semconv.CodingAgentAgentID, t.AgentID, scrub)
	setStr(span, semconv.GenAIToolName, t.ToolName, scrub)
	setStr(span, semconv.GenAIToolCallID, t.ToolUseID, scrub)
	setStr(span, semconv.CodingAgentToolGroupID, t.GroupID, scrub)
	setStr(span, semconv.CodingAgentToolGroupType, t.GroupType, scrub)
	if t.Iteration > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentToolIteration, t.Iteration))
	}
	setStr(span, semconv.CodingAgentToolTriggeringLLMRequestID, t.TriggeringLLMRequestID, scrub)
	if t.Model != "" {
		setStr(span, semconv.GenAIRequestModel, t.Model, scrub)
	}
	if t.Sandboxed {
		span.SetAttributes(attribute.Bool("coding_agent.tool.sandboxed", true))
	}
	if t.WorkingDir != "" {
		setStr(span, "code.cwd", t.WorkingDir, scrub)
	}
	if t.Command != "" {
		setStr(span, "coding_agent.tool.command", truncate(t.Command, 4096), scrub)
	}

	setStr(span, semconv.CodingAgentMCPServerName, t.MCPServerName, scrub)
	setStr(span, semconv.CodingAgentMCPScope, t.MCPScope, scrub)
	setStr(span, semconv.CodingAgentMCPTransport, t.MCPTransport, scrub)
	setStr(span, semconv.CodingAgentMCPSource, t.MCPSource, scrub)
	setStr(span, semconv.CodingAgentClient, t.Vendor, scrub)

	if t.Errored {
		setStr(span, semconv.ErrorType, nonEmpty(t.FailureType, "tool_error"), scrub)
		setStr(span, "exception.message", truncate(t.ErrorMsg, 1024), scrub)
		if t.IsInterrupt {
			span.SetAttributes(attribute.Bool("coding_agent.tool.interrupted", true))
		}
	}
	if t.Args != "" {
		setStr(span, semconv.GenAIToolCallArguments, truncate(t.Args, 8192), scrub)
	}
	if t.Result != "" {
		setStr(span, "gen_ai.tool.call.result", truncate(t.Result, 8192), scrub)
	}
	if dur := t.EndedAt.Sub(t.StartedAt); dur > 0 {
		span.SetAttributes(attribute.Int64("coding_agent.tool.duration_ms", dur.Milliseconds()))
	}
}

func nonEmpty(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func setLLMTurnAttrs(span trace.Span, t normalize.LLMTurn, scrub scrubFn, capture string) {
	span.SetAttributes(attribute.String(semconv.CodingAgentHookSchemaVersion, semconv.CodingAgentSchemaVersion))
	setStr(span, semconv.CodingAgentSessionID, t.SessionID, scrub)
	setStr(span, semconv.GenAIConversationID, t.ConversationID, scrub)
	setStr(span, semconv.CodingAgentClient, t.Vendor, scrub)
	if t.Vendor != "" {
		setStr(span, "gen_ai.agent.name", t.Vendor, scrub)
	}
	if t.Model != "" {
		setStr(span, semconv.GenAIRequestModel, t.Model, scrub)
		setStr(span, semconv.GenAIResponseModel, t.Model, scrub)
	}
	if t.GenerationID != "" {
		setStr(span, "gen_ai.response.id", t.GenerationID, scrub)
	}
	if t.UserEmail != "" {
		setStr(span, "user.email", t.UserEmail, scrub)
	}
	if t.AssistantMessageOnly {
		setStr(span, "coding_agent.llm.turn.kind", "assistant_only", scrub)
	} else if t.Prompt != "" {
		setStr(span, "coding_agent.llm.turn.kind", "user_prompt", scrub)
	}

	if t.InputTokens > 0 {
		span.SetAttributes(attribute.Int64(semconv.GenAIUsageInputTokens, t.InputTokens))
	}
	if t.OutputTokens > 0 {
		span.SetAttributes(attribute.Int64(semconv.GenAIUsageOutputTokens, t.OutputTokens))
	}
	if t.TotalTokens > 0 {
		span.SetAttributes(attribute.Int64(semconv.GenAIUsageTotalTokens, t.TotalTokens))
	}
	if t.CostUSD > 0 {
		span.SetAttributes(attribute.Float64(semconv.GenAIUsageCost, t.CostUSD))
	}
	if t.ThoughtMs > 0 {
		span.SetAttributes(attribute.Int64("coding_agent.llm.thought.duration_ms", t.ThoughtMs))
	}
	if len(t.AttachmentPaths) > 0 {
		span.SetAttributes(attribute.StringSlice("coding_agent.llm.turn.attachment.paths", t.AttachmentPaths))
		span.SetAttributes(attribute.Int("coding_agent.llm.turn.attachment.count", len(t.AttachmentPaths)))
	}

	// Prompt / response / thought bodies cross the wire only when the
	// operator opted into full capture. The redact tier-2 layer in
	// internal/redact already runs on every string under that mode.
	if capture == semconv.CodingAgentContentCaptureFull {
		setStr(span, semconv.GenAIInputMessages, truncate(t.Prompt, 16_000), scrub)
		setStr(span, semconv.GenAIOutputMessages, truncate(t.Response, 16_000), scrub)
		if t.ThoughtText != "" {
			setStr(span, "coding_agent.llm.thought.text", truncate(t.ThoughtText, 8_000), scrub)
		}
	}
}

func setSubagentAttrs(span trace.Span, s normalize.Subagent, scrub scrubFn) {
	span.SetAttributes(attribute.String(semconv.CodingAgentHookSchemaVersion, semconv.CodingAgentSchemaVersion))
	setStr(span, semconv.CodingAgentSessionID, s.SessionID, scrub)
	setStr(span, semconv.CodingAgentClient, s.Vendor, scrub)
	setStr(span, semconv.GenAIConversationID, s.ParentConversationID, scrub)
	setStr(span, semconv.CodingAgentAgentID, s.SubagentID, scrub)
	setStr(span, semconv.CodingAgentAgentParentID, s.ParentConversationID, scrub)
	setStr(span, semconv.CodingAgentAgentType, semconv.CodingAgentAgentTypeSubagent, scrub)
	setStr(span, semconv.CodingAgentSubagentType, s.SubagentType, scrub)
	setStr(span, semconv.CodingAgentLinkageConfidence, semconv.CodingAgentLinkageConfidenceHigh, scrub)
	setStr(span, "coding_agent.subagent.status", s.Status, scrub)
	setStr(span, "coding_agent.subagent.task", truncate(s.Task, 2_048), scrub)
	setStr(span, "coding_agent.subagent.description", truncate(s.Description, 1_024), scrub)
	setStr(span, "coding_agent.subagent.summary", truncate(s.Summary, 4_096), scrub)
	if s.Model != "" {
		setStr(span, semconv.GenAIRequestModel, s.Model, scrub)
	}
	if s.GitBranch != "" {
		setStr(span, "vcs.ref.head.name", s.GitBranch, scrub)
	}
	if s.ToolCallID != "" {
		setStr(span, "coding_agent.subagent.tool_call_id", s.ToolCallID, scrub)
	}
	if s.IsParallelWorker {
		span.SetAttributes(attribute.Bool("coding_agent.subagent.parallel_worker", true))
	}
	if s.DurationMs > 0 {
		span.SetAttributes(attribute.Int64("coding_agent.subagent.duration_ms", s.DurationMs))
	}
	if s.MessageCount > 0 {
		span.SetAttributes(attribute.Int("coding_agent.subagent.message_count", s.MessageCount))
	}
	if s.ToolCallCount > 0 {
		span.SetAttributes(attribute.Int("coding_agent.subagent.tool_call_count", s.ToolCallCount))
	}
	if s.LoopCount > 0 {
		span.SetAttributes(attribute.Int("coding_agent.subagent.loop_count", s.LoopCount))
	}
	if len(s.ModifiedFiles) > 0 {
		span.SetAttributes(attribute.StringSlice("coding_agent.subagent.modified_files", s.ModifiedFiles))
		span.SetAttributes(attribute.Int("coding_agent.subagent.modified_files.count", len(s.ModifiedFiles)))
	}
}

func setEditDecisionAttrs(span trace.Span, d normalize.EditDecision, scrub scrubFn) {
	span.SetAttributes(attribute.String(semconv.CodingAgentHookSchemaVersion, semconv.CodingAgentSchemaVersion))
	setStr(span, semconv.CodingAgentSessionID, d.SessionID, scrub)
	setStr(span, semconv.CodingAgentAgentID, d.AgentID, scrub)
	setStr(span, semconv.CodingAgentEditDecision, d.Decision, scrub)
	setStr(span, semconv.CodingAgentEditDecisionSource, d.Source, scrub)
	setStr(span, semconv.CodingAgentEditToolName, d.Tool, scrub)
	setStr(span, semconv.CodingAgentEditLanguage, d.Language, scrub)
	setStr(span, semconv.CodingAgentClient, d.Vendor, scrub)
	if d.LinesAdded > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentEditLinesAdded, d.LinesAdded))
	}
	if d.LinesRemoved > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentEditLinesRemoved, d.LinesRemoved))
	}
	if d.FilePath != "" {
		setStr(span, "code.file.path", d.FilePath, scrub)
	}
}

// setStr is the choke-point every string attribute flows through. The
// scrub closure runs on every value before it crosses the wire.
func setStr(span trace.Span, key, val string, scrub scrubFn) {
	if val == "" {
		return
	}
	if scrub != nil {
		val = scrub(val)
	}
	span.SetAttributes(attribute.String(key, val))
}

// setAnyAttr handles the heterogeneous values that flow through
// EmitEvent.Attrs. We narrow to OTel-supported types; anything else is
// stringified.
func setAnyAttr(span trace.Span, key string, v any, scrub scrubFn) {
	switch x := v.(type) {
	case string:
		setStr(span, key, x, scrub)
	case bool:
		span.SetAttributes(attribute.Bool(key, x))
	case int:
		span.SetAttributes(attribute.Int(key, x))
	case int64:
		span.SetAttributes(attribute.Int64(key, x))
	case float32:
		span.SetAttributes(attribute.Float64(key, float64(x)))
	case float64:
		span.SetAttributes(attribute.Float64(key, x))
	case []string:
		if scrub != nil {
			scrubbed := make([]string, len(x))
			for i, s := range x {
				scrubbed[i] = scrub(s)
			}
			x = scrubbed
		}
		span.SetAttributes(attribute.StringSlice(key, x))
	default:
		s := defaultString(v)
		setStr(span, key, s, scrub)
	}
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "...(truncated)"
}
