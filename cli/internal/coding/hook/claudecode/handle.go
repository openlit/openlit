package claudecode

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/classify"
	"github.com/openlit/openlit/cli/internal/coding/detect"
	"github.com/openlit/openlit/cli/internal/coding/git"
	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/coding/pricing"
	"github.com/openlit/openlit/cli/internal/coding/sessionstate"
	"github.com/openlit/openlit/cli/internal/coding/tailfile"
	"github.com/openlit/openlit/sdk/go/semconv"
)

// claudePayload covers the fields Claude Code sends across all hook
// events. Unknown fields are ignored. See
// https://code.claude.com/docs/en/hooks for the event-level schema and
// `.cursor/rules/coding-agents-convention.mdc` §4 for the mapping
// onto our canonical attributes.
type claudePayload struct {
	SessionID      string          `json:"session_id"`
	TranscriptPath string          `json:"transcript_path"`
	CWD            string          `json:"cwd"`
	HookEventName  string          `json:"hook_event_name"`
	PermissionMode string          `json:"permission_mode"`
	ToolName       string          `json:"tool_name"`
	ToolUseID      string          `json:"tool_use_id"`
	ToolInput      json.RawMessage `json:"tool_input"`
	ToolResponse   json.RawMessage `json:"tool_response"`
	StopHookActive bool            `json:"stop_hook_active"`
	Source         string          `json:"source"` // SessionStart subtypes (startup, resume, ...)
	Reason         string          `json:"reason"` // SessionEnd reason

	// UserPromptSubmit specific. Claude Code sends the entire user
	// prompt verbatim on this event. We only stamp the body when
	// content_capture_mode == "full" — otherwise just the length.
	Prompt string `json:"prompt"`

	// SubagentStop adds these (matcher + a short blurb). Documented
	// at https://code.claude.com/docs/en/hooks#subagentstop-input.
	SubagentType string `json:"subagent_type"`
	TaskID       string `json:"task_id"`
}

// handle is the per-invocation entry point. Claude Code passes events
// over stdin; we route each event to a span emitter using the same
// canonical types so the dashboard treats them uniformly.
func handle(ctx context.Context, in normalize.Input) error {
	var p claudePayload
	if err := json.Unmarshal(in.Payload, &p); err != nil {
		// Malformed payload — drop silently. The hook subcommand
		// already logs the parse error to stderr above us.
		return nil
	}

	event := in.Event
	if event == "" {
		event = p.HookEventName
	}

	vcs := git.Snapshot(ctx, p.CWD)
	// See cursor/handle.go for the rationale — v1 has no API-key
	// allowlist surface, so we flag the key signal as unknown.
	cls := classify.Classify(classify.Inputs{
		APIKeyAllowlistKnown: false,
		APIKeyOnAllowlist:    false,
		RepoURL:              vcs.RepoURL,
		RepoAllowlist:        classify.SplitAllowlist(os.Getenv("OPENLIT_CODING_REPO_ALLOWLIST")),
	})

	// Every event is a chance to drain new assistant turns from the
	// transcript. Stop fires after every assistant turn, so this gives
	// us per-turn LLM-turn spans (with output text + tokens) without
	// waiting for SessionEnd. PreToolUse / PostToolUse also drain so
	// long sessions don't accumulate unread tail.
	drainAssistantTurns(in, p)

	switch event {
	case "SessionStart":
		return emitSession(in, p, vcs, cls, "started", time.Time{})
	case "UserPromptSubmit":
		// Drain any leftover pending edits as rejections — Claude
		// Code skipped the matching PostToolUse, which most often
		// means the user denied the edit at the diff-review prompt
		// and the assistant moved on. This is the same heuristic
		// Anthropic's own monitoring docs describe under
		// `claude_code.code_edit_tool.decision = reject`.
		drainRejectedPendingEdits(in, p.SessionID)
		return emitUserPrompt(in, p)
	case "Stop":
		// Stop fires after every assistant turn — many times per
		// session. We emit a low-cost loop event here so dashboards
		// can count turns without inflating the session-span count.
		//
		// We also stamp `coding_agent.session.outcome = "completed"`
		// on this event-span so the sessions list reflects "agent
		// finished its loop" instead of remaining on the "running"
		// pill forever. Claude Code's `SessionEnd` only fires on
		// graceful exits (`/exit`, logout, clear) — closing VS Code
		// or starting a new chat skips it, leaving the row stuck.
		// The sessions rollup uses `argMaxIf(outcome, Timestamp,
		// non-empty)` so a later SessionEnd verdict (cancelled /
		// abandoned_with_change) still wins over this "completed"
		// stamp, which matches the user-visible truth: the chat
		// completed each turn, and the *terminal* outcome is
		// whatever SessionEnd reports.
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: p.SessionID,
			Name:      "coding_agent.session.loop.stop",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.client":            in.Vendor,
				"coding_agent.hook.event":        event,
				"coding_agent.session.loop.kind": "assistant_turn_end",
				"coding_agent.session.outcome":   semconv.CodingAgentSessionOutcomeCompleted,
			},
		})
	case "SessionEnd":
		// Drain any leftover pending edits as rejections — see the
		// UserPromptSubmit branch for the rationale. Doing this both
		// places ensures we attribute rejections whether the session
		// ended gracefully or via a fresh user prompt.
		drainRejectedPendingEdits(in, p.SessionID)
		// Authoritative session-close. Emit the full session span
		// with token rollups, realized cost, and outcome.
		return emitSession(in, p, vcs, cls, "ended", time.Now())
	case "PreToolUse":
		// Stash the proposed edit for the rejection heuristic when
		// the tool is an edit tool. PostToolUse will either resolve
		// it as an accept (and remove the entry) or UserPromptSubmit /
		// SessionEnd will drain it as a reject. Bash invocations are
		// passed through to the standard compact event below; git
		// commit / PR detection happens at PostToolUse where we have
		// the tool's stdout.
		if isEditTool(p.ToolName) {
			stashPendingEdit(in, p)
		}
		// Pre-event only; the full tool span is emitted at PostToolUse
		// time so we don't double-count. Still log a compact event so
		// dashboards can show the in-flight tool list.
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: p.SessionID,
			Name:      "coding_agent.tool.requested",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.client": in.Vendor,
				"gen_ai.tool.name":    p.ToolName,
				"gen_ai.tool.call.id": p.ToolUseID,
				"code.cwd":            p.CWD,
			},
		})
	case "PostToolUse":
		return emitToolCall(in, p, vcs, cls)
	case "SubagentStop":
		subagentType := p.SubagentType
		if subagentType == "" {
			// Claude Code's SubagentStop predates the dedicated
			// `subagent_type` field; older releases ship just the
			// stop signal. Default to the canonical "task" label
			// matching the Anthropic SDK so the UI's filter works.
			subagentType = "task"
		}
		return in.Emit.EmitSubagent(normalize.Subagent{
			SessionID:    p.SessionID,
			SubagentID:   p.TaskID,
			SubagentType: subagentType,
			Vendor:       in.Vendor,
			Status:       "completed",
			StartedAt:    time.Now(),
			EndedAt:      time.Now(),
		})
	default:
		// Unknown event — emit a low-cost span event so we have a
		// record in case we need to debug a vendor change.
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: p.SessionID,
			Name:      "coding_agent.hook.unknown_event",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.hook.event": event,
				"coding_agent.client":     in.Vendor,
			},
		})
	}
}

// drainAssistantTurns reads any new assistant turns from Claude Code's
// transcript JSONL since the last hook invocation and emits one
// `coding_agent.llm.turn` per *complete* turn (assistant message with a
// non-empty `stop_reason`). Streaming fragments sharing a RequestID are
// coalesced. Incomplete trailing turns leave the offset unchanged so the
// next invocation picks them up.

func drainAssistantTurns(in normalize.Input, p claudePayload) {
	sessionID := p.SessionID
	if sessionID == "" {
		return
	}

	transcriptPath := strings.TrimSpace(p.TranscriptPath)
	st := sessionstate.Load(sessionID, "claude-code")
	if transcriptPath == "" {
		transcriptPath = st.TranscriptPath
	}
	if transcriptPath == "" {
		return
	}
	if strings.HasPrefix(transcriptPath, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			transcriptPath = filepath.Join(home, strings.TrimPrefix(transcriptPath, "~/"))
		}
	}

	lines, newOffset, err := readTranscript(transcriptPath, st.TranscriptOffset)
	if err != nil || len(lines) == 0 {
		// Persist the path even if nothing new — later events without
		// a `transcript_path` field in the payload can still resume.
		if transcriptPath != st.TranscriptPath {
			st.TranscriptPath = transcriptPath
			sessionstate.Save(sessionID, "claude-code", st)
		}
		return
	}

	// Whether or not we end up emitting new turns, we can always
	// promote the transcript's `entrypoint` to a sessionstate-cached
	// `terminal.type`. This is the only signal that survives
	// Anthropic's env-scrubbed hook subprocess — the env / process-
	// tree detection in cli/internal/otlp/exporter.go runs without
	// it. Pick the first line that carries the field and persist;
	// re-reads on later events are cheap because the offset means
	// we touch at most the new tail.
	for _, line := range lines {
		if v := strings.TrimSpace(line.Entrypoint); v != "" {
			if host := hostFromEntrypoint(v); host != "" && st.TerminalType != host {
				st.TerminalType = host
			}
			break
		}
	}

	turns, userLines, safeOffset := coalesceAssistants(lines)
	if len(turns) == 0 {
		// Persist transcript path + terminal so a later event can resume.
		st.TranscriptPath = transcriptPath
		sessionstate.Save(sessionID, "claude-code", st)
		_ = newOffset
		return
	}

	// Build a quick index of the most recent user / tool_result context
	// per RequestID by walking the lines in transcript order.
	contextByTurnIdx := make(map[int]turnContext, len(turns))
	turnIdx := 0
	var pendingCtx turnContext
	for _, line := range userLines {
		ctx, ok := parseUserLine(line)
		if !ok {
			continue
		}
		pendingCtx = ctx
		// Attach `pendingCtx` to the next assistant turn we haven't
		// matched yet. We rely on transcript ordering: user line
		// precedes the assistant turn it triggered.
		for turnIdx < len(turns) {
			contextByTurnIdx[turnIdx] = pendingCtx
			turnIdx++
			break
		}
	}

	seenIDs := make(map[string]struct{}, len(st.EmittedAssistantTurnIDs))
	for _, id := range st.EmittedAssistantTurnIDs {
		seenIDs[id] = struct{}{}
	}

	emittedNew := false
	for i, t := range turns {
		turnKey := t.line.RequestID
		if turnKey == "" {
			turnKey = t.line.UUID
		}
		if _, ok := seenIDs[turnKey]; ok {
			continue
		}
		ctx := contextByTurnIdx[i]
		emitOneAssistantTurn(in, p, t, ctx)
		seenIDs[turnKey] = struct{}{}
		st.EmittedAssistantTurnIDs = append(st.EmittedAssistantTurnIDs, turnKey)
		emittedNew = true
	}

	if len(st.EmittedAssistantTurnIDs) > 256 {
		st.EmittedAssistantTurnIDs = st.EmittedAssistantTurnIDs[len(st.EmittedAssistantTurnIDs)-256:]
	}

	st.TranscriptPath = transcriptPath
	if safeOffset > st.TranscriptOffset {
		st.TranscriptOffset = safeOffset
	}
	if emittedNew {
		sessionstate.Save(sessionID, "claude-code", st)
	} else if transcriptPath != "" {
		// Even with no new turns, persist transcript path so future
		// events know where to resume.
		sessionstate.Save(sessionID, "claude-code", st)
	}
}

// emitOneAssistantTurn produces a single `coding_agent.llm.turn` span
// from a fully-coalesced assistant turn + the user/tool context that
// triggered it.
func emitOneAssistantTurn(in normalize.Input, p claudePayload, t coalescedTurn, ctx turnContext) {
	completedAt, _ := time.Parse(time.RFC3339Nano, t.line.Timestamp)
	if completedAt.IsZero() {
		completedAt = time.Now()
	}

	turn := normalize.LLMTurn{
		SessionID:           p.SessionID,
		ConversationID:      p.SessionID,
		GenerationID:        strings.TrimSpace(t.line.RequestID),
		Vendor:              in.Vendor,
		Model:               t.msg.Model,
		StartedAt:           completedAt,
		EndedAt:             completedAt,
		InputTokens:         t.msg.Usage.InputTokens + t.msg.Usage.CacheReadInputTokens + t.msg.Usage.CacheCreationInputTokens,
		OutputTokens:        t.msg.Usage.OutputTokens,
		CacheReadTokens:     t.msg.Usage.CacheReadInputTokens,
		CacheCreationTokens: t.msg.Usage.CacheCreationInputTokens,
	}
	turn.TotalTokens = turn.InputTokens + turn.OutputTokens
	if t.msg.StopReason != "" {
		turn.FinishReasons = []string{t.msg.StopReason}
	}
	if t.msg.Model != "" {
		rate := pricing.Lookup(t.msg.Model)
		turn.CostUSD = rate.Cost(turn.InputTokens, turn.OutputTokens, turn.CacheReadTokens+turn.CacheCreationTokens)
	}
	// Per-turn tags — surface the high-signal transcript fields
	// adapters used to drop. We namespace them under `claude_code.*`
	// so the same `coding_agent.llm.turn` schema can host them
	// alongside Cursor / Codex / Copilot turns without
	// colliding.
	turn.Extras = map[string]string{}
	if v := strings.TrimSpace(t.line.Version); v != "" {
		turn.Extras["claude_code.client.version"] = v
	}
	if v := strings.TrimSpace(t.line.Entrypoint); v != "" {
		turn.Extras["claude_code.entrypoint"] = v
		// drainAssistantTurns already cached this into sessionstate.
		// We still stamp it on the LLM turn span so a single span
		// detail panel renders the same host the resource attr does.
		if host := hostFromEntrypoint(v); host != "" {
			turn.Extras["terminal.type"] = host
		}
	}
	if v := strings.TrimSpace(t.line.GitBranch); v != "" {
		turn.Extras["vcs.ref.head.name"] = v
	}
	if v := strings.TrimSpace(t.line.CWD); v != "" {
		turn.Extras["code.cwd"] = v
	}
	if t.line.IsSidechain {
		turn.Extras["claude_code.is_sidechain"] = "true"
	}
	if len(turn.Extras) == 0 {
		turn.Extras = nil
	}

	if in.ContentCapture == semconv.CodingAgentContentCaptureFull {
		// Adapter pre-flattens the assistant turn into the fields
		// LLMTurn declares. The emitter (cli/internal/otlp/attrs.go)
		// builds the OTel-canonical `gen_ai.{input,output}.messages`
		// envelopes from these — adapters never construct that JSON
		// themselves, so the shape is guaranteed identical across
		// Cursor, Claude Code, Codex, and Copilot.
		text, thinking, toolCalls := splitAssistantContent(t.msg.Content)
		turn.Response = text
		turn.ThoughtText = thinking
		turn.OutputToolCalls = toolCalls
		if ctx.Prompt != "" {
			turn.Prompt = ctx.Prompt
		}
		if len(ctx.ToolResults) > 0 {
			turn.InputToolResults = make([]normalize.ToolResultPart, 0, len(ctx.ToolResults))
			for _, r := range ctx.ToolResults {
				turn.InputToolResults = append(turn.InputToolResults, normalize.ToolResultPart{
					ID:      r.ToolUseID,
					Result:  r.Content,
					IsError: r.IsError,
				})
			}
		}
	}

	_ = in.Emit.EmitLLMTurn(turn)
}

// splitAssistantContent returns the assistant turn split into:
//   - text   : concatenated `text` blocks (the chat answer)
//   - think  : concatenated `thinking` blocks (separate attribute)
//   - calls  : tool_use blocks as normalize.ToolCallPart entries —
//     these get rendered inside the OTel-canonical assistant message
//     as `{"type":"tool_call","id":…,"name":…,"arguments":…}` parts
//     by the emitter.
func splitAssistantContent(blocks []assistantContentBlock) (text, think string, calls []normalize.ToolCallPart) {
	var textParts, thoughtParts []string
	for _, b := range blocks {
		switch b.Type {
		case "text":
			if strings.TrimSpace(b.Text) != "" {
				textParts = append(textParts, b.Text)
			}
		case "thinking":
			// Claude transcripts store the body in `thinking`. Some
			// older builds wrote it under `text` — accept both.
			body := b.Thinking
			if body == "" {
				body = b.Text
			}
			if strings.TrimSpace(body) != "" {
				thoughtParts = append(thoughtParts, body)
			}
		case "tool_use":
			calls = append(calls, normalize.ToolCallPart{
				ID:        b.ID,
				Name:      b.Name,
				Arguments: string(b.Input),
			})
		}
	}
	return strings.Join(textParts, "\n\n"), strings.Join(thoughtParts, "\n\n"), calls
}

// emitUserPrompt fires on Claude Code's UserPromptSubmit hook. We
// produce a `coding_agent.llm.turn` span with `kind=prompt` so the
// session's chat view can render the user's intent without needing
// to tail the transcript on every read. The prompt body itself is
// gated by the content-capture mode — `full` keeps it verbatim,
// `metadata_only` and `minimal` keep only the length. See
// `.cursor/rules/coding-agents-convention.mdc` §4.
func emitUserPrompt(in normalize.Input, p claudePayload) error {
	now := time.Now()
	turn := normalize.LLMTurn{
		SessionID:      p.SessionID,
		ConversationID: p.SessionID,
		Vendor:         in.Vendor,
		StartedAt:      now,
		EndedAt:        now,
	}
	if in.ContentCapture == semconv.CodingAgentContentCaptureFull && p.Prompt != "" {
		turn.Prompt = p.Prompt
	}
	return in.Emit.EmitLLMTurn(turn)
}

func emitSession(
	in normalize.Input,
	p claudePayload,
	vcs git.Context,
	cls classify.Classification,
	kind string,
	endedAt time.Time,
) error {
	s := normalize.Session{
		SessionID:            p.SessionID,
		ConversationID:       p.SessionID,
		Vendor:               in.Vendor,
		StartedAt:            time.Now(),
		EndedAt:              endedAt,
		PermissionMode:       p.PermissionMode,
		CWD:                  p.CWD,
		RepoURL:              vcs.RepoURL,
		HeadSHA:              vcs.HeadSHA,
		BranchName:           vcs.Branch,
		VCSDirty:             vcs.Dirty,
		UserClassification:   cls.Value,
		ClassificationReason: cls.Reason,
		Extras: map[string]string{
			"coding_agent.hook.event":       p.HookEventName,
			"claude_code.transcript.path":   p.TranscriptPath,
			"claude_code.session.lifecycle": kind,
		},
	}
	if p.Source != "" {
		s.Extras["claude_code.session.source"] = p.Source
	}

	// Tail the transcript for both kinds. On `started`, this gives
	// us an early model attribution (so the session row shows a
	// provider/model immediately after the first turn instead of
	// waiting for SessionEnd). On `ended`, this gives us the
	// authoritative token + cost totals.
	if model, cost, in0, out0, total := tailTranscript(p.TranscriptPath); total > 0 || cost > 0 || model != "" {
		if model != "" {
			s.Model = model
		}
		if kind == "ended" {
			s.CostUSD = cost
			s.InputTokens = in0
			s.OutputTokens = out0
			s.TotalTokens = total
		}
	}

	if kind == "ended" {
		s.Outcome = outcomeFromReason(p.Reason, vcs.Dirty)
	}

	return in.Emit.EmitSession(s)
}

// outcomeFromReason maps Claude Code's SessionEnd reason onto our
// session-outcome enum. Without GitHub-App context we cannot know
// "merged" or "committed"; we report the closest local signal.
func outcomeFromReason(reason string, vcsDirty bool) string {
	switch reason {
	case "exit", "logout":
		if vcsDirty {
			return semconv.CodingAgentSessionOutcomeAbandonedWithChange
		}
		return semconv.CodingAgentSessionOutcomeAbandonedNoChange
	case "clear":
		return semconv.CodingAgentSessionOutcomeCancelled
	}
	if vcsDirty {
		return semconv.CodingAgentSessionOutcomeAbandonedWithChange
	}
	return semconv.CodingAgentSessionOutcomeAbandonedNoChange
}

// emitToolCall fires only on PostToolUse. PreToolUse is handled at the
// switch-level as a span event so we don't double-emit a tool span per
// invocation. VCS / classification context lands on the session-root
// span as resource attributes, so we don't need to re-stamp them here.
func emitToolCall(in normalize.Input, p claudePayload, vcs git.Context, cls classify.Classification) error {
	_ = vcs
	_ = cls
	t := normalize.ToolCall{
		SessionID:  p.SessionID,
		ToolName:   p.ToolName,
		ToolUseID:  p.ToolUseID,
		Vendor:     in.Vendor,
		WorkingDir: p.CWD,
		StartedAt:  time.Now(),
		EndedAt:    time.Now(),
	}
	// Surface a Bash command as the tool's canonical command so the
	// trace-detail view's "Shell" pill renders the right summary. The
	// raw string is still gated by capture mode in `attrs.go`.
	if p.ToolName == "Bash" {
		if cmd := stringFieldFromInput(p.ToolInput, "command"); cmd != "" {
			t.Command = cmd
			// Detect agent-attributed git commits / PR creations. The
			// Bash tool's stdout is available on `tool_response`; we
			// pass it to the detect helpers so the SHA / URL stamped
			// on the resulting GitCommit / GitPullRequest spans are
			// authoritative.
			emitGitArtifactsClaude(in, p, cmd)
		}
	}

	// Edit-decision: PostToolUse fired, so we resolve any PreToolUse
	// pending entry as an accept. When permission_mode is one of the
	// auto-accept modes the decision is `auto_accepted` rather than
	// `accept` so the dashboards can split user-driven vs policy-
	// driven accepts. Bumps both the session-state edit counters
	// and the OTel metrics counters (via the emitter), so the
	// session-root span carries the totals and Prometheus / Mimir
	// see the deltas in lock-step with the trace.
	if isEditTool(p.ToolName) {
		pending := sessionstate.TakePendingEdit(p.SessionID, in.Vendor, p.ToolUseID)
		decision := semconv.CodingAgentEditDecisionAccept
		source := semconv.CodingAgentEditDecisionSourceUserInteractive
		if p.PermissionMode == "auto_accept" || p.PermissionMode == "bypassPermissions" || p.PermissionMode == "acceptEdits" {
			decision = semconv.CodingAgentEditDecisionAutoAccepted
			source = semconv.CodingAgentEditDecisionSourcePolicy
		}
		ed := normalize.EditDecision{
			SessionID: p.SessionID,
			Decision:  decision,
			Source:    source,
			Tool:      p.ToolName,
			Vendor:    in.Vendor,
			At:        time.Now(),
			FilePath:  stringFieldFromInput(p.ToolInput, "file_path"),
		}
		if pending != nil {
			ed.LinesAdded = pending.LinesAdded
			ed.LinesRemoved = pending.LinesRemoved
			ed.Language = pending.Language
			if ed.FilePath == "" {
				ed.FilePath = pending.FilePath
			}
		}
		_ = in.Emit.EmitEditDecision(ed)
		sessionstate.BumpCodeCounters(p.SessionID, in.Vendor, ed.LinesAdded, ed.LinesRemoved, ed.LinesAdded, 0, 1, 0)
	}

	if in.ContentCapture == semconv.CodingAgentContentCaptureFull {
		if len(p.ToolInput) > 0 {
			t.Args = string(p.ToolInput)
		}
		if len(p.ToolResponse) > 0 {
			t.Result = string(p.ToolResponse)
		}
	}
	return in.Emit.EmitToolCall(t)
}

// stashPendingEdit caches the proposed edit body from a PreToolUse
// hook so PostToolUse can resolve it as an accept (or
// UserPromptSubmit / SessionEnd can drain it as a reject). Inspects
// the tool name to choose the right line-count strategy:
//
//   - Edit: `old_string` → `new_string` (use detect.CountInlineDiff)
//   - Write: `content` is the new body, treat as insertion-only
//   - MultiEdit: iterate the `edits[]` array of {old,new} pairs
//   - NotebookEdit: same as Edit semantically — `new_source` may be
//     present in lieu of `new_string`.
func stashPendingEdit(in normalize.Input, p claudePayload) {
	if p.ToolUseID == "" {
		return
	}
	filePath := stringFieldFromInput(p.ToolInput, "file_path")
	var added, removed int
	switch p.ToolName {
	case "Edit", "NotebookEdit":
		oldStr := stringFieldFromInput(p.ToolInput, "old_string")
		newStr := stringFieldFromInput(p.ToolInput, "new_string")
		if newStr == "" {
			newStr = stringFieldFromInput(p.ToolInput, "new_source")
		}
		added, removed = detect.CountInlineDiff(oldStr, newStr)
	case "Write":
		body := stringFieldFromInput(p.ToolInput, "content")
		added, _ = detect.CountInlineDiff("", body)
	case "MultiEdit":
		added, removed = countMultiEditLines(p.ToolInput)
	}
	sessionstate.AddPendingEdit(p.SessionID, in.Vendor, p.ToolUseID, &sessionstate.PendingEdit{
		ToolName:     p.ToolName,
		FilePath:     filePath,
		LinesAdded:   added,
		LinesRemoved: removed,
		Language:     guessLanguage(filePath),
	})
}

// drainRejectedPendingEdits emits one EditDecision per leftover
// pending edit, marked as `reject`. Called from UserPromptSubmit /
// SessionEnd. The function is a no-op when there are no pending
// entries (the common case for completed-turn sessions).
func drainRejectedPendingEdits(in normalize.Input, sessionID string) {
	leftover := sessionstate.DrainPendingEdits(sessionID, in.Vendor)
	if len(leftover) == 0 {
		return
	}
	for _, e := range leftover {
		if e == nil {
			continue
		}
		_ = in.Emit.EmitEditDecision(normalize.EditDecision{
			SessionID:    sessionID,
			Decision:     semconv.CodingAgentEditDecisionReject,
			Source:       semconv.CodingAgentEditDecisionSourceUserInteractive,
			Tool:         e.ToolName,
			Language:     e.Language,
			LinesAdded:   e.LinesAdded,
			LinesRemoved: e.LinesRemoved,
			FilePath:     e.FilePath,
			Vendor:       in.Vendor,
			At:           time.Now(),
		})
		sessionstate.BumpCodeCounters(sessionID, in.Vendor, 0, 0, 0, e.LinesAdded, 0, 1)
	}
}

// countMultiEditLines parses Claude Code's MultiEdit `tool_input` —
// `{ "file_path": "...", "edits": [{"old_string":..., "new_string":...}] }`
// — and totals lines-added/removed across every entry.
func countMultiEditLines(raw json.RawMessage) (added, removed int) {
	if len(raw) == 0 {
		return 0, 0
	}
	var m struct {
		Edits []struct {
			OldString string `json:"old_string"`
			NewString string `json:"new_string"`
		} `json:"edits"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return 0, 0
	}
	for _, e := range m.Edits {
		a, r := detect.CountInlineDiff(e.OldString, e.NewString)
		added += a
		removed += r
	}
	return added, removed
}

// guessLanguage maps the file extension onto a language tag for the
// edit-decision metric. Returns "" when we don't recognise the
// extension so the dashboard can group those into "other".
func guessLanguage(filePath string) string {
	if filePath == "" {
		return ""
	}
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".go":
		return "go"
	case ".ts", ".tsx":
		return "typescript"
	case ".js", ".jsx", ".mjs", ".cjs":
		return "javascript"
	case ".py":
		return "python"
	case ".rs":
		return "rust"
	case ".java":
		return "java"
	case ".kt", ".kts":
		return "kotlin"
	case ".swift":
		return "swift"
	case ".rb":
		return "ruby"
	case ".php":
		return "php"
	case ".c":
		return "c"
	case ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx":
		return "cpp"
	case ".h":
		return "c"
	case ".cs":
		return "csharp"
	case ".sh", ".bash", ".zsh":
		return "shell"
	case ".md", ".markdown":
		return "markdown"
	case ".json":
		return "json"
	case ".yml", ".yaml":
		return "yaml"
	case ".sql":
		return "sql"
	case ".css", ".scss", ".sass":
		return "css"
	case ".html", ".htm":
		return "html"
	}
	return ""
}

// emitGitArtifactsClaude inspects a Bash tool's command + stdout for
// git commit / PR create patterns and emits the matching spans + bumps
// the session-state counters. The tool response is pulled from
// `tool_response.stdout` when the field is a string; Anthropic also
// surfaces compound objects here so we fall back to the raw blob when
// stdout isn't extractable.
func emitGitArtifactsClaude(in normalize.Input, p claudePayload, cmd string) {
	if cmd == "" {
		return
	}
	stdout := bashStdout(p.ToolResponse)
	now := time.Now()
	if detect.IsGitCommit(cmd) {
		sha := detect.ExtractCommitSHA(stdout)
		message := ""
		if in.ContentCapture == semconv.CodingAgentContentCaptureFull {
			message = detect.ExtractCommitMessage(cmd)
		}
		_ = in.Emit.EmitGitCommit(normalize.GitCommit{
			SessionID:  p.SessionID,
			Vendor:     in.Vendor,
			Tool:       "Bash",
			SHA:        sha,
			Message:    message,
			WorkingDir: p.CWD,
			At:         now,
		})
		sessionstate.BumpCommitCount(p.SessionID, in.Vendor)
	}
	if detect.IsPullRequest(cmd) {
		url, num := detect.ExtractPRURLAndNumber(stdout)
		title := ""
		if in.ContentCapture == semconv.CodingAgentContentCaptureFull {
			title = detect.ExtractPRTitle(cmd)
		}
		_ = in.Emit.EmitGitPullRequest(normalize.GitPullRequest{
			SessionID:  p.SessionID,
			Vendor:     in.Vendor,
			Tool:       "Bash",
			URL:        url,
			Number:     num,
			Title:      title,
			WorkingDir: p.CWD,
			At:         now,
		})
		sessionstate.BumpPRCount(p.SessionID, in.Vendor)
	}
}

// bashStdout extracts the Bash tool's stdout from Claude Code's
// `tool_response` blob. The blob is sometimes a plain string and
// sometimes `{"stdout":"...","stderr":"...","exit_code":0}` — we
// handle both. Returns "" when neither shape applies so the detect
// helpers fall through to the cheaper command-only path.
func bashStdout(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var m struct {
		Stdout string `json:"stdout"`
		Output string `json:"output"`
	}
	if err := json.Unmarshal(raw, &m); err == nil {
		if m.Stdout != "" {
			return m.Stdout
		}
		return m.Output
	}
	return ""
}

// hostFromEntrypoint maps Anthropic's per-line `entrypoint` value to
// our `terminal.type` enum. `claude-vscode` → vscode, `claude-cursor`
// → cursor, anything else stays empty (the env / process-tree fallback
// in cli/internal/otlp/exporter.go can still rescue the stamp).
func hostFromEntrypoint(ep string) string {
	e := strings.ToLower(strings.TrimSpace(ep))
	switch {
	case strings.Contains(e, "vscode"), strings.Contains(e, "vs-code"), strings.Contains(e, "vs_code"):
		return "vscode"
	case strings.Contains(e, "cursor"):
		return "cursor"
	case strings.Contains(e, "windsurf"):
		return "windsurf"
	case strings.Contains(e, "jetbrains"), strings.Contains(e, "intellij"), strings.Contains(e, "pycharm"):
		return "jetbrains"
	}
	return ""
}

func isEditTool(name string) bool {
	switch name {
	case "Edit", "Write", "MultiEdit", "NotebookEdit":
		return true
	default:
		return false
	}
}

// stringFieldFromInput pulls a single string field out of the
// `tool_input` blob if present. We use it for `file_path` (Edit /
// Write / MultiEdit / NotebookEdit) and `command` (Bash). Returns "" on
// any error so the caller can decide what to do.
func stringFieldFromInput(raw json.RawMessage, field string) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	v, ok := m[field]
	if !ok || len(v) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(v, &s); err != nil {
		return ""
	}
	return s
}

// tailTranscript scans the end of a Claude Code transcript JSONL file
// for the final usage line. The transcript format is one JSON object
// per line, with assistant turns carrying a `usage` object that totals
// input/output/cache tokens for that turn. We sum the assistant turns
// and use the per-model pricing table (cli/internal/coding/pricing) to
// realize a USD cost.
//
// Returns zero values when the path is missing or unreadable; the hook
// path always tolerates missing transcript data.
func tailTranscript(path string) (model string, cost float64, inTokens, outTokens, total int64) {
	if path == "" {
		return "", 0, 0, 0, 0
	}
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(home, strings.TrimPrefix(path, "~/"))
		}
	}
	// F3: bound the read to the last `DefaultCap` bytes so the hook
	// never blocks on a multi-GB transcript. Marathon sessions whose
	// usage rolls up across the boundary will undercount tokens —
	// we accept that in exchange for predictable hook latency. The
	// last-N-bytes window comfortably holds a multi-hour session at
	// realistic Claude turn sizes.
	lines := tailfile.Tail(path, tailfile.DefaultCap)
	if len(lines) == 0 {
		return "", 0, 0, 0, 0
	}
	type usage struct {
		InputTokens                  int64 `json:"input_tokens"`
		OutputTokens                 int64 `json:"output_tokens"`
		CacheCreationInputTokens     int64 `json:"cache_creation_input_tokens"`
		CacheReadInputTokens         int64 `json:"cache_read_input_tokens"`
	}
	type turn struct {
		Type    string `json:"type"`
		Message struct {
			Model string `json:"model"`
			Usage usage  `json:"usage"`
		} `json:"message"`
	}

	var ti, to, cached int64
	var lastModel string
	for _, line := range lines {
		var t turn
		if err := json.Unmarshal(line, &t); err != nil {
			continue
		}
		// Anthropic transcript reports cache creation + cache read as
		// separate counters; "fresh" input is the standard input_tokens.
		// The OTel field gen_ai.usage.input_tokens should equal total
		// distinct input the model saw, so we sum them.
		fresh := t.Message.Usage.InputTokens
		creation := t.Message.Usage.CacheCreationInputTokens
		read := t.Message.Usage.CacheReadInputTokens
		ti += fresh + creation + read
		cached += creation + read
		to += t.Message.Usage.OutputTokens
		if t.Message.Model != "" {
			lastModel = t.Message.Model
		}
	}
	rate := pricing.Lookup(lastModel)
	cost = rate.Cost(ti, to, cached)
	return lastModel, cost, ti, to, ti + to
}
