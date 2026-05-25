package cursor

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/classify"
	"github.com/openlit/openlit/cli/internal/coding/git"
	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/coding/pricing"
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
	ConversationID string `json:"conversation_id"`
	GenerationID   string `json:"generation_id"`
	SessionID      string `json:"session_id"`
	UserEmail      string `json:"user_email"`
	CursorVersion  string `json:"cursor_version"`
	WorkspaceRoots []string `json:"workspace_roots"`
	IsBackground   bool   `json:"is_background_agent"`
	ComposerMode   string `json:"composer_mode"`
	Model          string `json:"model"`

	// beforeSubmitPrompt
	Prompt      string                  `json:"prompt"`
	Attachments []cursorAttachment      `json:"attachments"`

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
	Trigger             string `json:"trigger"`
	ContextUsagePct     int    `json:"context_usage_percent"`
	ContextTokens       int64  `json:"context_tokens"`
	ContextWindowSize   int64  `json:"context_window_size"`
	MessageCount        int    `json:"message_count"`
	MessagesToCompact   int    `json:"messages_to_compact"`
	IsFirstCompaction   bool   `json:"is_first_compaction"`

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
	Description    string   `json:"description"`
	Summary        string   `json:"summary"`
	SubMessageCount int     `json:"message_count_subagent"` // alias avoidance — see normalize step
	ToolCallCount  int      `json:"tool_call_count"`
	ModifiedFiles  []string `json:"modified_files"`
	TranscriptPath string   `json:"agent_transcript_path"`
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

	// Cursor's `session_id` is sometimes absent; fall back to
	// conversation_id which is stable across the same composer thread.
	sessionID := p.SessionID
	if sessionID == "" {
		sessionID = p.ConversationID
	}

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
		return in.Emit.EmitLLMTurn(normalize.LLMTurn{
			SessionID:      sessionID,
			ConversationID: p.ConversationID,
			Vendor:         in.Vendor,
			StartedAt:      time.Now().Add(-time.Duration(p.DurationMs) * time.Millisecond),
			EndedAt:        time.Now(),
			ThoughtText:    p.Text,
			ThoughtMs:      p.DurationMs,
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
				"coding_agent.client":     in.Vendor,
				"gen_ai.tool.name":        p.ToolName,
				"gen_ai.tool.call.id":     p.ToolUseID,
				"code.cwd":                p.CWD,
				"gen_ai.request.model":    p.Model,
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
		return in.Emit.EmitSubagent(normalize.Subagent{
			SessionID:     sessionID,
			SubagentType:  p.SubagentType,
			Task:          p.Task,
			Description:   p.Description,
			Summary:       p.Summary,
			Vendor:        in.Vendor,
			DurationMs:    p.DurationMs,
			MessageCount:  p.MessageCount,
			ToolCallCount: p.ToolCallCount,
			LoopCount:     p.LoopCount,
			Status:        nonEmpty(p.Status, "completed"),
			ModifiedFiles: p.ModifiedFiles,
			StartedAt:     startedAt,
			EndedAt:       time.Now(),
		})

	case "beforeShellExecution":
		// Pre-event for shell — small request event, full span on after.
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: sessionID,
			Name:      "coding_agent.shell.requested",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.client":          in.Vendor,
				"coding_agent.tool.command":    truncateStr(p.Command, 4096),
				"coding_agent.tool.sandboxed":  p.Sandbox,
				"code.cwd":                     p.CWD,
			},
		})

	case "afterShellExecution":
		return in.Emit.EmitToolCall(normalize.ToolCall{
			SessionID:  sessionID,
			ToolName:   "shell",
			Vendor:     in.Vendor,
			Command:    p.Command,
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
				"coding_agent.client":         in.Vendor,
				"gen_ai.tool.name":            p.ToolName,
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
		linesAdded, linesRemoved := totalLines(p.Edits)
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
				"coding_agent.client":                       in.Vendor,
				"coding_agent.session.compact.trigger":      p.Trigger,
				"coding_agent.session.compact.usage_pct":    p.ContextUsagePct,
				"coding_agent.session.compact.tokens":       p.ContextTokens,
				"coding_agent.session.compact.window_size": p.ContextWindowSize,
				"coding_agent.session.compact.message_count":  p.MessageCount,
				"coding_agent.session.compact.messages_to_compact": p.MessagesToCompact,
				"coding_agent.session.compact.is_first":       p.IsFirstCompaction,
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
	s := normalize.Session{
		SessionID:            sessionID,
		ConversationID:       p.ConversationID,
		Vendor:               in.Vendor,
		ClientVersion:        p.CursorVersion,
		StartedAt:            startedAt,
		EndedAt:              endedAt,
		PermissionMode:       p.ComposerMode,
		UserID:               p.UserEmail,
		RepoURL:              vcs.RepoURL,
		HeadSHA:              vcs.HeadSHA,
		BranchName:           vcs.Branch,
		VCSDirty:             vcs.Dirty,
		UserClassification:   cls.Value,
		ClassificationReason: cls.Reason,
		Extras: map[string]string{
			"coding_agent.hook.event":    p.HookEventName,
			"cursor.session.lifecycle":   kind,
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
	cost := rate.Cost(inputTokens, 0, 0)
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
	cost := rate.Cost(0, outputTokens, 0)
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
		SessionID:  sessionID,
		ToolName:   p.ToolName,
		ToolUseID:  p.ToolUseID,
		Vendor:     in.Vendor,
		Model:      p.Model,
		WorkingDir: p.CWD,
		StartedAt:  startedAt,
		EndedAt:    time.Now(),
		Args:       captureIfFull(in.ContentCapture, string(p.ToolInput)),
		Result:     captureIfFull(in.ContentCapture, p.ToolOutput),
	}
}

func buildToolCallFailure(in normalize.Input, p cursorPayload, sessionID string) normalize.ToolCall {
	startedAt := time.Now().Add(-time.Duration(p.Duration) * time.Millisecond)
	return normalize.ToolCall{
		SessionID:    sessionID,
		ToolName:     p.ToolName,
		ToolUseID:    p.ToolUseID,
		Vendor:       in.Vendor,
		Errored:      true,
		ErrorMsg:     p.ErrorMessage,
		FailureType:  p.FailureType,
		IsInterrupt:  p.IsInterrupt,
		WorkingDir:   p.CWD,
		StartedAt:    startedAt,
		EndedAt:      time.Now(),
		Args:         captureIfFull(in.ContentCapture, string(p.ToolInput)),
	}
}

// outcomeFromReason maps Cursor's sessionEnd `reason` + `final_status`
// onto our coding_agent.session.outcome enum. Cursor doesn't have a
// "merged"/"committed" concept; that's GitHub-App territory in v2.
func outcomeFromReason(reason, final string) string {
	switch reason {
	case "completed":
		return semconv.CodingAgentSessionOutcomeAbandonedNoChange
	case "user_close", "window_close":
		return semconv.CodingAgentSessionOutcomeCancelled
	case "aborted":
		return semconv.CodingAgentSessionOutcomeCancelled
	case "error":
		return semconv.CodingAgentSessionOutcomeAbandonedWithChange
	}
	switch final {
	case "completed":
		return semconv.CodingAgentSessionOutcomeAbandonedNoChange
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
// edits[] array. Cursor doesn't provide pre-computed counts, so we
// approximate by counting newlines in old/new strings.
func totalLines(edits []cursorEdit) (added, removed int) {
	for _, e := range edits {
		added += strings.Count(e.NewString, "\n")
		removed += strings.Count(e.OldString, "\n")
	}
	return added, removed
}

func captureIfFull(mode, s string) string {
	if mode != semconv.CodingAgentContentCaptureFull {
		return ""
	}
	return s
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
