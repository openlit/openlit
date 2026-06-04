package cursor

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/classify"
	"github.com/openlit/openlit/cli/internal/coding/detect"
	"github.com/openlit/openlit/cli/internal/coding/git"
	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/coding/pricing"
	"github.com/openlit/openlit/cli/internal/coding/sessionstate"
	"github.com/openlit/openlit/sdk/go/semconv"
)

// cursorPayload is a wide JSON struct that covers every field across
// all 13+ Cursor hook events we subscribe to. Each event populates a
// different subset; we union them so we don't have to multiplex on the
// event name at unmarshal time. Unknown fields are ignored, so if
// Cursor adds keys we silently keep working.
//
// Field reference: cursor.com/docs/hooks (2026-05).
type cursorPayload struct {
	HookEventName string `json:"hook_event_name"`

	// Common identifiers across most events.
	ConversationID string   `json:"conversation_id"`
	GenerationID   string   `json:"generation_id"`
	SessionID      string   `json:"session_id"`
	UserEmail      string   `json:"user_email"`
	CursorVersion  string   `json:"cursor_version"`
	WorkspaceRoots []string `json:"workspace_roots"`
	IsBackground   bool     `json:"is_background_agent"`
	ComposerMode   string   `json:"composer_mode"`
	Model          string   `json:"model"`

	// beforeSubmitPrompt
	Prompt      string             `json:"prompt"`
	Attachments []cursorAttachment `json:"attachments"`

	// afterAgentResponse / afterAgentThought
	Text       string `json:"text"`
	DurationMs int64  `json:"duration_ms"`

	// preToolUse / postToolUse / postToolUseFailure
	ToolName     string          `json:"tool_name"`
	ToolUseID    string          `json:"tool_use_id"`
	ToolInput    json.RawMessage `json:"tool_input"`
	ToolOutput   string          `json:"tool_output"`
	ResultJSON   string          `json:"result_json"`
	AgentMessage string          `json:"agent_message"`
	ErrorMessage string          `json:"error_message"`
	FailureType  string          `json:"failure_type"`
	IsInterrupt  bool            `json:"is_interrupt"`
	Duration     int64           `json:"duration"` // postToolUse uses `duration`, not `duration_ms`

	// beforeShellExecution / afterShellExecution
	Command string `json:"command"`
	Output  string `json:"output"`
	Sandbox bool   `json:"sandbox"`
	CWD     string `json:"cwd"`

	// beforeReadFile
	FilePath string `json:"file_path"`
	Content  string `json:"content"`

	// afterFileEdit
	Edits []cursorEdit `json:"edits"`

	// preCompact
	Trigger           string `json:"trigger"`
	ContextUsagePct   int    `json:"context_usage_percent"`
	ContextTokens     int64  `json:"context_tokens"`
	ContextWindowSize int64  `json:"context_window_size"`
	MessageCount      int    `json:"message_count"`
	MessagesToCompact int    `json:"messages_to_compact"`
	IsFirstCompaction bool   `json:"is_first_compaction"`

	// stop / sessionEnd
	Status      string `json:"status"`
	LoopCount   int    `json:"loop_count"`
	Reason      string `json:"reason"`
	FinalStatus string `json:"final_status"`

	// subagentStart
	SubagentID           string `json:"subagent_id"`
	SubagentType         string `json:"subagent_type"`
	Task                 string `json:"task"`
	ParentConversationID string `json:"parent_conversation_id"`
	ToolCallID           string `json:"tool_call_id"`
	SubagentModel        string `json:"subagent_model"`
	IsParallelWorker     bool   `json:"is_parallel_worker"`
	GitBranch            string `json:"git_branch"`

	// subagentStop
	Description     string   `json:"description"`
	Summary         string   `json:"summary"`
	SubMessageCount int      `json:"message_count_subagent"` // alias avoidance — see normalize step
	ToolCallCount   int      `json:"tool_call_count"`
	ModifiedFiles   []string `json:"modified_files"`
	TranscriptPath  string   `json:"agent_transcript_path"`
}

type cursorAttachment struct {
	Type     string `json:"type"`
	FilePath string `json:"file_path"`
}

type cursorEdit struct {
	OldString string `json:"old_string"`
	NewString string `json:"new_string"`
	OldLine   string `json:"old_line"`
	NewLine   string `json:"new_line"`
}

func handle(ctx context.Context, in normalize.Input) error {
	var p cursorPayload
	if err := json.Unmarshal(in.Payload, &p); err != nil {
		fmt.Fprintf(os.Stderr, "openlit: cursor payload parse failed: %v\n", err)
		return nil
	}
	event := in.Event
	if event == "" {
		event = p.HookEventName
	}

	cwd := p.CWD
	if cwd == "" && len(p.WorkspaceRoots) > 0 {
		cwd = p.WorkspaceRoots[0]
	}
	if cwd == "" {
		// last resort — use process cwd
		if wd, err := os.Getwd(); err == nil {
			cwd = wd
		}
	}

	vcs := git.Snapshot(ctx, cwd)
	// v1: the CLI has no path to the org's API-key allowlist, so we
	// flag the API-key signal as unknown (APIKeyAllowlistKnown=false)
	// and let the classifier lean on the repo signal. The earlier
	// "OPENLIT_API_KEY != \"\"" heuristic was actively wrong — having
	// the env var set says nothing about whether the key is recognised
	// by the org and was producing spurious `personal` labels.
	cls := classify.Classify(classify.Inputs{
		APIKeyAllowlistKnown: false,
		APIKeyOnAllowlist:    false,
		RepoURL:              vcs.RepoURL,
		RepoAllowlist:        classify.SplitAllowlist(os.Getenv("OPENLIT_CODING_REPO_ALLOWLIST")),
	})

	// Chat-thread key. Cursor exposes two ids:
	//   - conversation_id: the composer / chat-thread id, stable for
	//     the life of the chat (survives Cursor restarts, plan-mode
	//     toggles, subagent spawns inside the same thread).
	//   - session_id: a per-process / per-invocation id that can be
	//     absent on some events and is not guaranteed stable across
	//     the lifetime of one chat.
	// We use conversation_id as the primary key so every span fired
	// by one chat (including subagents the chat spawns) folds into
	// one chat row. session_id is the fallback when conversation_id
	// is missing (early-lifecycle events on older Cursor builds).
	sessionID := p.ConversationID
	if sessionID == "" {
		sessionID = p.SessionID
	}

	// Mode + model transition events are now emitted centrally in
	// cli/internal/coding/hook/hook.go for ALL three coding agents
	// (Cursor / Claude Code / Codex), so we don't duplicate that
	// logic here. The cache update for the latest value still
	// happens via peekContext + sessionstate.Save in hook.go.

	switch event {
	case "sessionStart":
		return in.Emit.EmitSession(buildSession(in, p, sessionID, vcs, cls, "started", time.Time{}))

	case "sessionEnd":
		// sessionEnd is the authoritative session-closing event. We
		// stamp the outcome from the `reason` / `final_status` fields
		// rather than guessing.
		startedAt := time.Now().Add(-time.Duration(p.DurationMs) * time.Millisecond)
		s := buildSession(in, p, sessionID, vcs, cls, "ended", time.Now())
		if !startedAt.IsZero() && p.DurationMs > 0 {
			s.StartedAt = startedAt
			s.Duration = time.Duration(p.DurationMs) * time.Millisecond
		}
		s.Outcome = outcomeFromReason(p.Reason, p.FinalStatus)
		return in.Emit.EmitSession(s)

	case "stop":
		// Cursor's `stop` fires when the agent loop terminates. We
		// emit a small event so dashboards can count loop turns; the
		// authoritative session end span comes from sessionEnd.
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: sessionID,
			Name:      "coding_agent.session.loop.stop",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.client":              in.Vendor,
				"coding_agent.hook.event":          event,
				"coding_agent.session.loop.status": p.Status,
				"coding_agent.session.loop.count":  p.LoopCount,
			},
		})

	case "beforeSubmitPrompt":
		return in.Emit.EmitLLMTurn(buildPromptTurn(in, p, sessionID))

	case "afterAgentResponse":
		return in.Emit.EmitLLMTurn(buildResponseTurn(in, p, sessionID))

	case "afterAgentThought":
		// Reasoning / thinking text is real model output: the provider
		// charged tokens for it just like for the final assistant
		// message. Estimate output tokens from the thought text and
		// run them through the same pricing path as a normal response
		// turn — without this the session cost rolled-up at the UI
		// level under-counts thinking-heavy models (Claude
		// extended-thinking, GPT-5 reasoning) by a wide margin.
		thoughtTokens := pricing.EstimateTokens(p.Text)
		thoughtRate := pricing.Lookup(p.Model)
		thoughtCost := thoughtRate.Cost(0, thoughtTokens, 0, 0)
		return in.Emit.EmitLLMTurn(normalize.LLMTurn{
			SessionID:      sessionID,
			ConversationID: p.ConversationID,
			Vendor:         in.Vendor,
			Model:          p.Model,
			StartedAt:      time.Now().Add(-time.Duration(p.DurationMs) * time.Millisecond),
			EndedAt:        time.Now(),
			ThoughtText:    p.Text,
			ThoughtMs:      p.DurationMs,
			OutputTokens:   thoughtTokens,
			TotalTokens:    thoughtTokens,
			CostUSD:        thoughtCost,
		})

	case "preToolUse":
		// Pre is intentionally a low-cost event; the full tool span
		// is emitted at postToolUse or postToolUseFailure time so we
		// don't double-count.
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: sessionID,
			Name:      "coding_agent.tool.requested",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.client":  in.Vendor,
				"gen_ai.tool.name":     p.ToolName,
				"gen_ai.tool.call.id":  p.ToolUseID,
				"code.cwd":             p.CWD,
				"gen_ai.request.model": p.Model,
			},
		})

	case "postToolUse":
		return in.Emit.EmitToolCall(buildToolCallSuccess(in, p, sessionID))

	case "postToolUseFailure":
		return in.Emit.EmitToolCall(buildToolCallFailure(in, p, sessionID))

	case "subagentStart":
		return in.Emit.EmitSubagent(normalize.Subagent{
			SessionID:            sessionID,
			ParentConversationID: p.ParentConversationID,
			SubagentID:           p.SubagentID,
			SubagentType:         p.SubagentType,
			Task:                 p.Task,
			Vendor:               in.Vendor,
			Model:                p.SubagentModel,
			GitBranch:            p.GitBranch,
			IsParallelWorker:     p.IsParallelWorker,
			ToolCallID:           p.ToolCallID,
			Status:               "started",
			StartedAt:            time.Now(),
		})

	case "subagentStop":
		startedAt := time.Now().Add(-time.Duration(p.DurationMs) * time.Millisecond)
		// Re-stamp every linkage attribute we know about. The earlier
		// version dropped SubagentID + ParentConversationID + ToolCallID
		// on Stop, which broke parent ↔ child ↔ tool-call joins in the
		// trace view (we'd see the subagent.stop span with no way to
		// match it against the subagent.start span or the spawning
		// Task tool call). Status is the only non-Start field that
		// genuinely differs between the two events.
		return in.Emit.EmitSubagent(normalize.Subagent{
			SessionID:            sessionID,
			ParentConversationID: p.ParentConversationID,
			SubagentID:           p.SubagentID,
			SubagentType:         p.SubagentType,
			Task:                 p.Task,
			Description:          p.Description,
			Summary:              p.Summary,
			Vendor:               in.Vendor,
			Model:                p.SubagentModel,
			GitBranch:            p.GitBranch,
			IsParallelWorker:     p.IsParallelWorker,
			ToolCallID:           p.ToolCallID,
			DurationMs:           p.DurationMs,
			MessageCount:         p.MessageCount,
			ToolCallCount:        p.ToolCallCount,
			LoopCount:            p.LoopCount,
			Status:               nonEmpty(p.Status, "completed"),
			ModifiedFiles:        p.ModifiedFiles,
			StartedAt:            startedAt,
			EndedAt:              time.Now(),
		})

	case "beforeShellExecution":
		// Pre-event for shell — small request event, full span on after.
		// B4 fix: in metadata mode we leak just the command's first
		// token (binary name) so dashboards still get "git" vs "rm"
		// counts, but no flags or paths or remote URLs that may
		// contain secrets / customer identifiers. Full mode keeps
		// the entire command for forensic detail.
		attrs := map[string]any{
			"coding_agent.client":         in.Vendor,
			"coding_agent.tool.sandboxed": p.Sandbox,
			"code.cwd":                    p.CWD,
		}
		if cmdAttr := commandForMode(in.ContentCapture, p.Command); cmdAttr != "" {
			attrs["coding_agent.tool.command"] = cmdAttr
		}
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: sessionID,
			Name:      "coding_agent.shell.requested",
			At:        time.Now(),
			Attrs:     attrs,
		})

	case "afterShellExecution":
		// Detect agent-attributed git commits + PR creations from the
		// shell tool's command body. We always inspect the verbatim
		// command (regardless of content-capture mode) because the
		// detection is structural — the helpers only carry SHAs /
		// URLs onto the emitted spans, and ExtractCommitMessage /
		// ExtractPRTitle are gated on `full` capture by the emitter.
		emitGitArtifacts(in, p, sessionID)
		return in.Emit.EmitToolCall(normalize.ToolCall{
			SessionID: sessionID,
			ToolName:  "shell",
			Vendor:    in.Vendor,
			// Gate Command + Args together so a viewer in metadata
			// mode sees only the binary name on the tool.call span.
			Command:    commandForMode(in.ContentCapture, p.Command),
			Sandboxed:  p.Sandbox,
			WorkingDir: p.CWD,
			StartedAt:  time.Now().Add(-time.Duration(p.Duration) * time.Millisecond),
			EndedAt:    time.Now(),
			Args:       captureIfFull(in.ContentCapture, p.Command),
			Result:     captureIfFull(in.ContentCapture, p.Output),
		})

	case "beforeMCPExecution":
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: sessionID,
			Name:      "coding_agent.mcp.tool.requested",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.client":          in.Vendor,
				"gen_ai.tool.name":             p.ToolName,
				"coding_agent.mcp.server.name": serverNameFromMCPInput(p.ToolInput),
			},
		})

	case "afterMCPExecution":
		return in.Emit.EmitToolCall(normalize.ToolCall{
			SessionID:     sessionID,
			ToolName:      p.ToolName,
			Vendor:        in.Vendor,
			MCPServerName: serverNameFromMCPInput(p.ToolInput),
			MCPSource:     semconv.CodingAgentMCPSourceMarketplace,
			StartedAt:     time.Now().Add(-time.Duration(p.Duration) * time.Millisecond),
			EndedAt:       time.Now(),
			Args:          captureIfFull(in.ContentCapture, string(p.ToolInput)),
			Result:        captureIfFull(in.ContentCapture, p.ResultJSON),
		})

	case "beforeReadFile":
		return in.Emit.EmitToolCall(normalize.ToolCall{
			SessionID:  sessionID,
			ToolName:   "read_file",
			Vendor:     in.Vendor,
			WorkingDir: p.CWD,
			StartedAt:  time.Now(),
			EndedAt:    time.Now(),
			Args:       captureIfFull(in.ContentCapture, p.FilePath),
		})

	case "afterFileEdit":
		// Each edit becomes one EditDecision so dashboards can count
		// per-file edits. Cursor gives us old/new strings, no
		// permission_mode, so we infer auto_accepted (Cursor edits
		// are always auto-applied; the user reviews after the fact).
		//
		// We also accumulate the per-session LOC + edit counters in
		// sessionstate so sessionEnd can stamp the totals on the
		// root span without re-reading every per-edit span.
		linesAdded, linesRemoved := totalLines(p.Edits)
		sessionstate.BumpCodeCounters(sessionID, in.Vendor, linesAdded, linesRemoved, linesAdded, 0, 1, 0)
		return in.Emit.EmitEditDecision(normalize.EditDecision{
			SessionID:    sessionID,
			Decision:     semconv.CodingAgentEditDecisionAutoAccepted,
			Source:       semconv.CodingAgentEditDecisionSourcePolicy,
			Tool:         "afterFileEdit",
			LinesAdded:   linesAdded,
			LinesRemoved: linesRemoved,
			FilePath:     p.FilePath,
			Vendor:       in.Vendor,
			At:           time.Now(),
		})

	case "preCompact":
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: sessionID,
			Name:      "coding_agent.session.compact",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.client":                              in.Vendor,
				"coding_agent.session.compact.trigger":             p.Trigger,
				"coding_agent.session.compact.usage_pct":           p.ContextUsagePct,
				"coding_agent.session.compact.tokens":              p.ContextTokens,
				"coding_agent.session.compact.window_size":         p.ContextWindowSize,
				"coding_agent.session.compact.message_count":       p.MessageCount,
				"coding_agent.session.compact.messages_to_compact": p.MessagesToCompact,
				"coding_agent.session.compact.is_first":            p.IsFirstCompaction,
			},
		})

	default:
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: sessionID,
			Name:      "coding_agent.hook.unknown_event",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.hook.event": event,
				"coding_agent.client":     in.Vendor,
			},
		})
	}
}

func buildSession(in normalize.Input, p cursorPayload, sessionID string, vcs git.Context, cls classify.Classification, kind string, endedAt time.Time) normalize.Session {
	startedAt := time.Now()
	if !endedAt.IsZero() && p.DurationMs > 0 {
		startedAt = endedAt.Add(-time.Duration(p.DurationMs) * time.Millisecond)
	}
	cwd := p.CWD
	if cwd == "" && len(p.WorkspaceRoots) > 0 {
		cwd = p.WorkspaceRoots[0]
	}
	s := normalize.Session{
		SessionID:            sessionID,
		ConversationID:       p.ConversationID,
		Vendor:               in.Vendor,
		ClientVersion:        p.CursorVersion,
		Model:                p.Model,
		StartedAt:            startedAt,
		EndedAt:              endedAt,
		PermissionMode:       p.ComposerMode,
		UserID:               p.UserEmail,
		CWD:                  cwd,
		RepoURL:              vcs.RepoURL,
		HeadSHA:              vcs.HeadSHA,
		BranchName:           vcs.Branch,
		VCSDirty:             vcs.Dirty,
		UserClassification:   cls.Value,
		ClassificationReason: cls.Reason,
		Extras: map[string]string{
			"coding_agent.hook.event":      p.HookEventName,
			"cursor.session.lifecycle":     kind,
			"cursor.session.composer_mode": p.ComposerMode,
		},
	}
	if p.IsBackground {
		s.Extras["cursor.session.is_background_agent"] = "true"
	}
	if p.Reason != "" {
		s.Extras["cursor.session.end.reason"] = p.Reason
	}
	if p.FinalStatus != "" {
		s.Extras["cursor.session.end.final_status"] = p.FinalStatus
	}
	// D6: high-value identifiers Cursor exposes but we previously
	// dropped. These let support / forensic tooling jump from a
	// session row back to the on-disk transcript and reproduce what
	// the user saw inside their IDE.
	if len(p.WorkspaceRoots) > 0 {
		// Joined with `;` so the dashboard query can split it back
		// out. The OTel-standard `code.workspace.roots` is a string
		// array; we encode as semicolons here because Extras is a
		// flat map[string]string.
		s.Extras["code.workspace.roots"] = strings.Join(p.WorkspaceRoots, ";")
	}
	if p.TranscriptPath != "" {
		s.Extras["coding_agent.session.transcript_path"] = p.TranscriptPath
	}
	return s
}

func buildPromptTurn(in normalize.Input, p cursorPayload, sessionID string) normalize.LLMTurn {
	paths := make([]string, 0, len(p.Attachments))
	for _, a := range p.Attachments {
		if a.FilePath != "" {
			paths = append(paths, a.FilePath)
		}
	}
	now := time.Now()
	// Cursor doesn't expose token counts on hook payloads, so we
	// estimate from prompt length and apply the static pricing table.
	// This is intentionally a lower bound — when the model surfaces
	// real usage (Codex rollout, Claude transcript), prefer that.
	inputTokens := pricing.EstimateTokens(p.Prompt)
	rate := pricing.Lookup(p.Model)
	cost := rate.Cost(inputTokens, 0, 0, 0)
	return normalize.LLMTurn{
		SessionID:       sessionID,
		ConversationID:  p.ConversationID,
		GenerationID:    p.GenerationID,
		Vendor:          in.Vendor,
		Model:           p.Model,
		StartedAt:       now,
		EndedAt:         now,
		Prompt:          p.Prompt,
		AttachmentPaths: paths,
		UserEmail:       p.UserEmail,
		InputTokens:     inputTokens,
		TotalTokens:     inputTokens,
		CostUSD:         cost,
	}
}

func buildResponseTurn(in normalize.Input, p cursorPayload, sessionID string) normalize.LLMTurn {
	now := time.Now()
	outputTokens := pricing.EstimateTokens(p.Text)
	rate := pricing.Lookup(p.Model)
	cost := rate.Cost(0, outputTokens, 0, 0)
	return normalize.LLMTurn{
		SessionID:            sessionID,
		ConversationID:       p.ConversationID,
		GenerationID:         p.GenerationID,
		Vendor:               in.Vendor,
		Model:                p.Model,
		StartedAt:            now,
		EndedAt:              now,
		Response:             p.Text,
		AssistantMessageOnly: true,
		OutputTokens:         outputTokens,
		TotalTokens:          outputTokens,
		CostUSD:              cost,
	}
}

func buildToolCallSuccess(in normalize.Input, p cursorPayload, sessionID string) normalize.ToolCall {
	startedAt := time.Now().Add(-time.Duration(p.Duration) * time.Millisecond)
	return normalize.ToolCall{
		SessionID:              sessionID,
		ToolName:               p.ToolName,
		ToolUseID:              p.ToolUseID,
		Vendor:                 in.Vendor,
		Model:                  p.Model,
		WorkingDir:             p.CWD,
		StartedAt:              startedAt,
		EndedAt:                time.Now(),
		Args:                   captureIfFull(in.ContentCapture, string(p.ToolInput)),
		Result:                 captureIfFull(in.ContentCapture, p.ToolOutput),
		AgentMessage:           captureIfFull(in.ContentCapture, p.AgentMessage),
		TriggeringLLMRequestID: p.GenerationID,
		MCPServerName:          serverNameFromMCPInput(p.ToolInput),
		MCPScope:               mcpScopeFromTool(p.ToolName, p.ToolInput),
		MCPTransport:           mcpTransportFromTool(p.ToolName, p.ToolInput),
	}
}

func buildToolCallFailure(in normalize.Input, p cursorPayload, sessionID string) normalize.ToolCall {
	startedAt := time.Now().Add(-time.Duration(p.Duration) * time.Millisecond)
	return normalize.ToolCall{
		SessionID:              sessionID,
		ToolName:               p.ToolName,
		ToolUseID:              p.ToolUseID,
		Vendor:                 in.Vendor,
		Errored:                true,
		ErrorMsg:               p.ErrorMessage,
		FailureType:            p.FailureType,
		IsInterrupt:            p.IsInterrupt,
		WorkingDir:             p.CWD,
		StartedAt:              startedAt,
		EndedAt:                time.Now(),
		Args:                   captureIfFull(in.ContentCapture, string(p.ToolInput)),
		AgentMessage:           captureIfFull(in.ContentCapture, p.AgentMessage),
		TriggeringLLMRequestID: p.GenerationID,
	}
}

// mcpScopeFromTool / mcpTransportFromTool tease the MCP metadata out
// of a tool-input JSON blob. Cursor packs both fields into tool_input
// for MCP tools (`scope`: user|workspace, `transport`: stdio|sse). We
// surface them as separate attributes so dashboards can group by
// trust boundary without parsing JSON at query time.
func mcpScopeFromTool(toolName string, raw json.RawMessage) string {
	if !strings.HasPrefix(toolName, "mcp_") || len(raw) == 0 {
		return ""
	}
	var m struct {
		Scope string `json:"scope"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	return m.Scope
}

func mcpTransportFromTool(toolName string, raw json.RawMessage) string {
	if !strings.HasPrefix(toolName, "mcp_") || len(raw) == 0 {
		return ""
	}
	var m struct {
		Transport string `json:"transport"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	return m.Transport
}

// outcomeFromReason maps Cursor's sessionEnd `reason` + `final_status`
// onto our coding_agent.session.outcome enum. Cursor doesn't have a
// "merged"/"committed" concept; that's GitHub-App territory in v2.
//
// D3 fix: previously "completed" → "abandoned_no_change", which is the
// opposite of what the word means and made the Outcome column in the
// dashboard misleading. Now:
//   - completed → completed (literally)
//   - user_close / window_close / aborted → cancelled
//   - error → abandoned_with_change (we know edits happened but the
//     run errored; safer to treat as needing review)
func outcomeFromReason(reason, final string) string {
	switch reason {
	case "completed":
		return semconv.CodingAgentSessionOutcomeCompleted
	case "user_close", "window_close":
		return semconv.CodingAgentSessionOutcomeCancelled
	case "aborted":
		return semconv.CodingAgentSessionOutcomeCancelled
	case "error":
		return semconv.CodingAgentSessionOutcomeAbandonedWithChange
	}
	switch final {
	case "completed":
		return semconv.CodingAgentSessionOutcomeCompleted
	case "aborted":
		return semconv.CodingAgentSessionOutcomeCancelled
	}
	return ""
}

func serverNameFromMCPInput(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var m struct {
		URL     string `json:"url"`
		Command string `json:"command"`
		Server  string `json:"server"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	if m.Server != "" {
		return m.Server
	}
	if m.URL != "" {
		return m.URL
	}
	if m.Command != "" {
		fields := strings.Fields(m.Command)
		if len(fields) > 0 {
			return fields[0]
		}
	}
	return ""
}

// totalLines counts roughly how many lines were added/removed across an
// edits[] array. Cursor doesn't provide pre-computed counts, so we run
// detect.CountInlineDiff over every entry's `old_string` / `new_string`
// pair. CountInlineDiff handles the empty / one-sided cases correctly
// (insertions and deletions); the older newline-count heuristic was
// reporting `0 lines added` whenever the new content fit on a single
// line, which is the common edit pattern for in-place rewrites.
func totalLines(edits []cursorEdit) (added, removed int) {
	for _, e := range edits {
		a, r := detect.CountInlineDiff(e.OldString, e.NewString)
		added += a
		removed += r
	}
	return added, removed
}

// emitGitArtifacts inspects a Cursor `afterShellExecution` payload and
// emits a GitCommit / GitPullRequest span (and bumps the matching
// session-state counter) when the command was a `git commit` / PR
// creation. We DO NOT gate on content-capture mode because the
// detection helpers only carry safe scalars (SHA, URL, number) — the
// body-bearing fields (message, title) are gated downstream in the
// emitter.
func emitGitArtifacts(in normalize.Input, p cursorPayload, sessionID string) {
	if p.Command == "" {
		return
	}
	now := time.Now()
	if detect.IsGitCommit(p.Command) {
		sha := detect.ExtractCommitSHA(p.Output)
		_ = in.Emit.EmitGitCommit(normalize.GitCommit{
			SessionID:  sessionID,
			Vendor:     in.Vendor,
			UserID:     p.UserEmail,
			Tool:       "shell",
			SHA:        sha,
			Message:    captureIfFull(in.ContentCapture, detect.ExtractCommitMessage(p.Command)),
			WorkingDir: p.CWD,
			At:         now,
		})
		sessionstate.BumpCommitCount(sessionID, in.Vendor)
	}
	if detect.IsPullRequest(p.Command) {
		url, num := detect.ExtractPRURLAndNumber(p.Output)
		_ = in.Emit.EmitGitPullRequest(normalize.GitPullRequest{
			SessionID:  sessionID,
			Vendor:     in.Vendor,
			UserID:     p.UserEmail,
			Tool:       "shell",
			URL:        url,
			Number:     num,
			Title:      captureIfFull(in.ContentCapture, detect.ExtractPRTitle(p.Command)),
			WorkingDir: p.CWD,
			At:         now,
		})
		sessionstate.BumpPRCount(sessionID, in.Vendor)
	}
}

func captureIfFull(mode, s string) string {
	if mode != semconv.CodingAgentContentCaptureFull {
		return ""
	}
	return s
}

// commandForMode trims an executable's full command line to whatever
// the active capture mode permits. Used for any pre-execution event
// where we want a metric (binary name, frequency) but must not leak
// the arguments, which routinely contain customer paths, tokens, and
// remote URLs. Full mode keeps the entire command (truncated at 4KB);
// metadata / minimal keep just the first token.
func commandForMode(mode, raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if mode == semconv.CodingAgentContentCaptureFull {
		return truncateStr(raw, 4096)
	}
	// metadata + minimal: first token (binary), no flags, no paths.
	if i := strings.IndexAny(raw, " \t"); i > 0 {
		return raw[:i]
	}
	return raw
}

func nonEmpty(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func truncateStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}
