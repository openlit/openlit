// Helpers that translate normalize.* values into OTel attributes. Kept
// in their own file so exporter.go stays small.
//
// Every string-typed attribute funnels through the supplied scrub
// function (a no-op-friendly closure from internal/redact). Numeric and
// boolean attributes go through unscrubbed since they can't carry
// secrets in any meaningful way.
//
// Capture-mode matrix (Phase C):
//
//	+-----------------------------+---------+-----------+----------+
//	| attribute family            | minimal | metadata  |  full    |
//	+-----------------------------+---------+-----------+----------+
//	| session-root timings/cost   | ✓       | ✓         | ✓        |
//	| session-root identity (user)| ✓       | ✓         | ✓        |
//	| coding_agent.session.id +   | ✓       | ✓         | ✓        |
//	|   gen_ai.conversation.id    |         |           |          |
//	| repo url / branch / commit  | ✓       | ✓         | ✓        |
//	| per-event spans             |   ─     | ✓         | ✓        |
//	| tool.name + duration + cost |   ─     | ✓         | ✓        |
//	| tool.command (first token)  |   ─     | ✓ (head)  | ✓ (full) |
//	| tool args / tool result     |   ─     |   ─       | ✓        |
//	| llm.turn timings + tokens   |   ─     | ✓         | ✓        |
//	| llm.turn prompt / response  |   ─     |   ─       | ✓        |
//	| llm.turn.thought text       |   ─     |   ─       | ✓        |
//	| coding_agent.content_capture| ✓       | ✓         | ✓        |
//	|   resource attribute        |         |           |          |
//	+-----------------------------+---------+-----------+----------+
//
// The matrix is enforced by:
//   - exporter.go's Emit* methods: in minimal mode, EmitToolCall /
//     EmitLLMTurn / EmitSubagent / EmitEditDecision / EmitEvent become
//     no-ops at the span level and instead bump a counter on the
//     sessionstate cache; the final EmitSession reads the counters
//     onto the session-root span (see C3).
//   - setToolCallAttrs / setLLMTurnAttrs / setSubagentAttrs accept the
//     mode and gate body attributes through `bodyAllowed`.

package otlp

import (
	"encoding/json"
	"strings"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/sdk/go/semconv"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// scrubFn is the redactor signature emitter passes around. Equivalent
// to internal/redact.ForCapture's return type but redeclared locally so
// this file doesn't depend on the redact package.
type scrubFn func(string) string

// bodyAllowed returns true when the active capture mode permits
// prompt / response / tool-argument bodies on a span. Centralised
// here so a future mode (e.g. "redacted_full") only needs to update
// this single switch.
func bodyAllowed(mode string) bool {
	return mode == semconv.CodingAgentContentCaptureFull
}

// perEventSpansAllowed returns true when the active capture mode
// permits emitting per-event spans (tool.call, llm.turn, subagent,
// edit.decision, and events). Minimal mode collapses these into
// rolled-up counters on the session-root span.
func perEventSpansAllowed(mode string) bool {
	return mode != semconv.CodingAgentContentCaptureMinimal
}

// inferProvider returns the OTel-standard `gen_ai.system` value based
// on the model name and (as a last resort) the vendor. We deliberately
// only handle the model families our adapters report; everything else
// gets the empty string so dashboards know not to render a misleading
// system value. Extend as we add more agents.
func inferProvider(model, vendor string) string {
	m := strings.ToLower(model)
	switch {
	case strings.HasPrefix(m, "claude"), strings.HasPrefix(m, "anthropic/"):
		return "anthropic"
	case strings.HasPrefix(m, "gpt"), strings.HasPrefix(m, "o1"),
		strings.HasPrefix(m, "o3"), strings.HasPrefix(m, "o4"),
		strings.HasPrefix(m, "openai/"):
		return "openai"
	case strings.HasPrefix(m, "gemini"), strings.HasPrefix(m, "google/"):
		return "google"
	case strings.HasPrefix(m, "grok"):
		return "xai"
	case strings.HasPrefix(m, "deepseek"):
		return "deepseek"
	}
	switch strings.ToLower(vendor) {
	case "claude-code", "claudecode", "cc":
		return "anthropic"
	case "codex":
		return "openai"
	}
	return ""
}

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
		// Dual-stamp until every downstream consumer is on
		// gen_ai.provider.name. See sdk/go/semconv/genai.go for the
		// rationale — OTel 1.36 renamed `gen_ai.system` and we want
		// both keys present during the transition window.
		setStr(span, semconv.GenAISystem, s.Provider, scrub)
		setStr(span, semconv.GenAIProviderName, s.Provider, scrub)
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

	// Code-change rollups — always stamped onto the session-root span
	// regardless of content-capture mode. Line / accept / reject /
	// commit / pr counts are scalar telemetry, not user content, so
	// minimal mode keeps them; otherwise dashboards lose the most
	// useful column on the Sessions list.
	if s.LinesAdded > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentSessionLinesAdded, s.LinesAdded))
	}
	if s.LinesRemoved > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentSessionLinesRemoved, s.LinesRemoved))
	}
	if s.LinesAccepted > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentSessionLinesAccepted, s.LinesAccepted))
	}
	if s.LinesRejected > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentSessionLinesRejected, s.LinesRejected))
	}
	if s.EditAcceptCount > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentSessionEditAcceptCount, s.EditAcceptCount))
	}
	if s.EditRejectCount > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentSessionEditRejectCount, s.EditRejectCount))
	}
	if s.CommitCount > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentSessionCommitCount, s.CommitCount))
	}
	if s.PRCount > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentSessionPRCount, s.PRCount))
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
	setStr(span, "code.cwd", s.CWD, scrub)

	for k, v := range s.Extras {
		setStr(span, k, v, scrub)
	}
}

func setToolCallAttrs(span trace.Span, t normalize.ToolCall, scrub scrubFn, capture string) {
	span.SetAttributes(attribute.String(semconv.CodingAgentHookSchemaVersion, semconv.CodingAgentSchemaVersion))
	setStr(span, semconv.CodingAgentSessionID, t.SessionID, scrub)
	setStr(span, semconv.CodingAgentAgentID, t.AgentID, scrub)
	// OTel GenAI canonical op.name for tool spans. Without this the
	// GenAI dashboards can't classify the span as a tool execution
	// (they fall through to "internal" and the tool-latency widget
	// goes blank).
	setStr(span, semconv.GenAIOperationName, "execute_tool", scrub)
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
		// In metadata / minimal modes the adapter has already
		// trimmed `Command` to the binary head via
		// commandForMode (cursor/handle.go). Re-apply truncation
		// at full mode only.
		if bodyAllowed(capture) {
			setStr(span, "coding_agent.tool.command", truncate(t.Command, 4096), scrub)
		} else {
			setStr(span, "coding_agent.tool.command", truncate(t.Command, 256), scrub)
		}
	}

	setStr(span, semconv.CodingAgentMCPServerName, t.MCPServerName, scrub)
	setStr(span, semconv.CodingAgentMCPScope, t.MCPScope, scrub)
	setStr(span, semconv.CodingAgentMCPTransport, t.MCPTransport, scrub)
	setStr(span, semconv.CodingAgentMCPSource, t.MCPSource, scrub)
	setStr(span, semconv.CodingAgentClient, t.Vendor, scrub)

	if t.Errored {
		// Stamp the boolean alongside the error.type string so
		// dashboards filtering on `errored = true` work without
		// the implicit "error.type non-empty" idiom (which fires
		// false positives on shell tools that surface stderr but
		// completed successfully).
		span.SetAttributes(attribute.Bool("coding_agent.tool.errored", true))
		setStr(span, semconv.ErrorType, nonEmpty(t.FailureType, "tool_error"), scrub)
		setStr(span, "exception.message", truncate(t.ErrorMsg, 1024), scrub)
		if t.IsInterrupt {
			span.SetAttributes(attribute.Bool("coding_agent.tool.interrupted", true))
		}
		// Set the OTel span status to Error so the trace tree shows
		// the failed tool span in red and parent rollups treat the
		// span as failed. Previously failed tools left the span
		// status Unset (visually "ok") which masked breakage in
		// the chat view.
		span.SetStatus(codes.Error, truncate(nonEmpty(t.ErrorMsg, "tool_error"), 256))
	}
	// Bodies are gated through bodyAllowed so adapters can't
	// accidentally leak args/result when capture is metadata/minimal.
	// Adapters call captureIfFull themselves too, but this is the
	// last-line defence so a future adapter that forgets the helper
	// still can't push prompts onto the wire in metadata mode.
	if t.Args != "" && bodyAllowed(capture) {
		setStr(span, semconv.GenAIToolCallArguments, truncate(t.Args, 8192), scrub)
	}
	if t.Result != "" && bodyAllowed(capture) {
		setStr(span, "gen_ai.tool.call.result", truncate(t.Result, 8192), scrub)
	}
	if t.AgentMessage != "" && bodyAllowed(capture) {
		setStr(span, "coding_agent.tool.agent_message", truncate(t.AgentMessage, 4096), scrub)
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
	// D5: GenAI semconv parity. Every llm.turn span should declare:
	//   gen_ai.operation.name — the OTel-standard verb for "this was
	//     a chat completion". Other valid values are "text_completion",
	//     "embeddings"; coding agents always run chat.
	//   gen_ai.system — the model provider (anthropic/openai/google).
	//     Falls back to vendor when we don't know better.
	// Without these two attrs the GenAI dashboards in the
	// OpenTelemetry catalogue can't render this span.
	setStr(span, "gen_ai.operation.name", "chat", scrub)
	if sys := inferProvider(t.Model, t.Vendor); sys != "" {
		setStr(span, semconv.GenAISystem, sys, scrub)
		setStr(span, semconv.GenAIProviderName, sys, scrub)
	}
	if t.Model != "" {
		setStr(span, semconv.GenAIRequestModel, t.Model, scrub)
		setStr(span, semconv.GenAIResponseModel, t.Model, scrub)
	}
	if t.GenerationID != "" {
		setStr(span, "gen_ai.response.id", t.GenerationID, scrub)
	}
	if len(t.FinishReasons) > 0 {
		span.SetAttributes(attribute.StringSlice("gen_ai.response.finish_reasons", t.FinishReasons))
	}
	if t.CacheReadTokens > 0 {
		span.SetAttributes(attribute.Int64("gen_ai.usage.cache.read_input_tokens", t.CacheReadTokens))
	}
	if t.CacheCreationTokens > 0 {
		span.SetAttributes(attribute.Int64("gen_ai.usage.cache.creation_input_tokens", t.CacheCreationTokens))
	}
	if t.UserEmail != "" {
		// Mirror onto both keys until consumers cut over. `user.email`
		// is the legacy `coding_agent.*` shape; `gen_ai.request.user`
		// is the OTel GenAI canonical (matches the per-request user
		// identifier semconv).
		setStr(span, "user.email", t.UserEmail, scrub)
		setStr(span, semconv.GenAIRequestUser, t.UserEmail, scrub)
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
		// Paths may be absolute and rooted under $HOME — scrub
		// every element so token/secret patterns embedded in
		// filenames (e.g. `/tmp/sk_live_…`) don't leak.
		setStrSlice(span, "coding_agent.llm.turn.attachment.paths", t.AttachmentPaths, scrub)
		span.SetAttributes(attribute.Int("coding_agent.llm.turn.attachment.count", len(t.AttachmentPaths)))
	}
	for k, v := range t.Extras {
		setStr(span, k, v, scrub)
	}

	// Prompt / response / thought bodies cross the wire only when
	// `bodyAllowed(capture)` is true (i.e. full mode). The redact
	// tier-2 layer in internal/redact already runs on every string
	// in this mode. We serialise everything into OTel-canonical
	// `gen_ai.{input,output}.messages` envelopes here — adapters
	// pass us plain strings + structured tool refs, never JSON.
	if bodyAllowed(capture) {
		if in := buildInputMessagesJSON(t); in != "" {
			setStr(span, semconv.GenAIInputMessages, truncate(in, 16_000), scrub)
		}
		if out := buildOutputMessagesJSON(t); out != "" {
			setStr(span, semconv.GenAIOutputMessages, truncate(out, 16_000), scrub)
		}
		if t.ThoughtText != "" {
			setStr(span, "coding_agent.llm.thought.text", truncate(t.ThoughtText, 8_000), scrub)
		}
	}
}

// buildInputMessagesJSON produces the JSON value for
// `gen_ai.input.messages` per the OTel GenAI semantic conventions
// (https://github.com/open-telemetry/semantic-conventions-genai →
// docs/gen-ai/gen-ai-spans.md). Each message has `role` + `parts`;
// each text part uses `{"type":"text","content":"..."}`.
//
// Design note — we deliberately do NOT serialise `tool_call_response`
// parts here even though the OTel GenAI spec allows them. Vendors
// like Claude Code and Codex bundle every preceding tool's result
// body into each turn's input (Anthropic / OpenAI message format),
// which makes a single turn's messages JSON balloon well past the
// 16 KB span-attribute cap — at which point the value gets truncated,
// the chat view's JSON parser fails, and the entire truncated blob
// falls back to rendering as a "user" message bubble.
//
// The canonical source for tool inputs / outputs is the dedicated
// `coding_agent.tool.call` span (which carries
// `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result`). The
// chat view interleaves those spans with LLM turns by timestamp, so
// nothing is lost — the conversation reconstructs from per-turn LLM
// spans + per-tool tool.call spans without duplicative narration.
//
// Returns "" when there is nothing to record so adapters don't stamp
// an empty `[]`.
func buildInputMessagesJSON(t normalize.LLMTurn) string {
	type part map[string]any
	type message map[string]any

	s := strings.TrimSpace(t.Prompt)
	if s == "" {
		return ""
	}
	msgs := []message{{
		"role":  "user",
		"parts": []part{{"type": "text", "content": t.Prompt}},
	}}
	body, err := json.Marshal(msgs)
	if err != nil {
		return ""
	}
	return string(body)
}

// buildOutputMessagesJSON produces the OTel-canonical JSON for
// `gen_ai.output.messages`. The output is a single assistant message
// with the response text and a `finish_reason` at the message level
// (per the spec example, line 79 of docs/gen-ai/gen-ai-spans.md).
//
// See `buildInputMessagesJSON` for why tool_call parts are not
// serialised here even though the OTel GenAI spec allows them: the
// `coding_agent.tool.call` span is the canonical source for tool
// arguments + results, and bundling them into the LLM-turn message
// blob blows past the span-attribute size cap.
func buildOutputMessagesJSON(t normalize.LLMTurn) string {
	type part map[string]any
	type message map[string]any

	parts := make([]part, 0, 1)
	if s := strings.TrimSpace(t.Response); s != "" {
		parts = append(parts, part{"type": "text", "content": t.Response})
	}
	if len(parts) == 0 && len(t.FinishReasons) == 0 {
		return ""
	}
	msg := message{
		"role":  "assistant",
		"parts": parts,
	}
	if len(t.FinishReasons) > 0 {
		msg["finish_reason"] = t.FinishReasons[0]
	}
	body, err := json.Marshal([]message{msg})
	if err != nil {
		return ""
	}
	return string(body)
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
		// Canonical OTel GenAI key for tool-call linkage. Stamping
		// this on the subagent span lets the UI join (parent's Task
		// tool call ↔ subagent block) by id, which is what the chat
		// view's "Subagent" collapsible expects.
		setStr(span, semconv.GenAIToolCallID, s.ToolCallID, scrub)
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
		// Subagent file lists are typically absolute paths under
		// the user's workspace — route through scrub so any
		// embedded token-shaped substrings get redacted.
		setStrSlice(span, "coding_agent.subagent.modified_files", s.ModifiedFiles, scrub)
		span.SetAttributes(attribute.Int("coding_agent.subagent.modified_files.count", len(s.ModifiedFiles)))
	}
}

// setGitCommitAttrs stamps the canonical attributes for a single
// `coding_agent.git.commit` span. Message body is gated by content
// capture; SHA + user + working dir are always safe.
func setGitCommitAttrs(span trace.Span, c normalize.GitCommit, scrub scrubFn, capture string) {
	span.SetAttributes(attribute.String(semconv.CodingAgentHookSchemaVersion, semconv.CodingAgentSchemaVersion))
	setStr(span, semconv.CodingAgentSessionID, c.SessionID, scrub)
	setStr(span, semconv.CodingAgentClient, c.Vendor, scrub)
	if c.UserID != "" {
		setStr(span, semconv.GenAIRequestUser, c.UserID, scrub)
	}
	if c.Tool != "" {
		setStr(span, semconv.GenAIToolName, c.Tool, scrub)
	}
	setStr(span, semconv.CodingAgentGitCommitSHA, c.SHA, scrub)
	if c.WorkingDir != "" {
		setStr(span, "code.cwd", c.WorkingDir, scrub)
	}
	if c.Message != "" && bodyAllowed(capture) {
		setStr(span, semconv.CodingAgentGitCommitMessage, truncate(c.Message, 4096), scrub)
	}
}

// setGitPullRequestAttrs stamps the canonical attributes for a single
// `coding_agent.git.pull_request` span. Title body is gated by
// content capture; URL + number + user + working dir are always safe.
func setGitPullRequestAttrs(span trace.Span, p normalize.GitPullRequest, scrub scrubFn, capture string) {
	span.SetAttributes(attribute.String(semconv.CodingAgentHookSchemaVersion, semconv.CodingAgentSchemaVersion))
	setStr(span, semconv.CodingAgentSessionID, p.SessionID, scrub)
	setStr(span, semconv.CodingAgentClient, p.Vendor, scrub)
	if p.UserID != "" {
		setStr(span, semconv.GenAIRequestUser, p.UserID, scrub)
	}
	if p.Tool != "" {
		setStr(span, semconv.GenAIToolName, p.Tool, scrub)
	}
	setStr(span, semconv.CodingAgentGitPRURL, p.URL, scrub)
	if p.Number > 0 {
		span.SetAttributes(attribute.Int(semconv.CodingAgentGitPRNumber, p.Number))
	}
	if p.WorkingDir != "" {
		setStr(span, "code.cwd", p.WorkingDir, scrub)
	}
	if p.Title != "" && bodyAllowed(capture) {
		setStr(span, semconv.CodingAgentGitPRTitle, truncate(p.Title, 2048), scrub)
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

// setStrSlice is the slice counterpart to setStr — every element is
// passed through the scrub closure before the slice crosses the wire.
// Use this for any attribute whose elements may contain user-supplied
// content (absolute file paths, command lines, free-text args). The
// raw `attribute.StringSlice` constructor bypasses redaction, which
// is fine for fully-controlled enum values (vendor names, finish
// reasons) but a leak for everything else.
func setStrSlice(span trace.Span, key string, vals []string, scrub scrubFn) {
	if len(vals) == 0 {
		return
	}
	if scrub != nil {
		scrubbed := make([]string, len(vals))
		for i, v := range vals {
			scrubbed[i] = scrub(v)
		}
		vals = scrubbed
	}
	span.SetAttributes(attribute.StringSlice(key, vals))
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
