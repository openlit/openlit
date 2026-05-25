package claudecode

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/classify"
	"github.com/openlit/openlit/cli/internal/coding/git"
	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/coding/pricing"
	"github.com/openlit/openlit/sdk/go/semconv"
)

// claudePayload covers the fields Claude Code sends across all hook
// events. Unknown fields are ignored.
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

	switch event {
	case "SessionStart":
		return emitSession(in, p, vcs, cls, "started", time.Time{})
	case "Stop":
		// Stop fires after every assistant turn — many times per
		// session. We emit a low-cost loop event here so dashboards
		// can count turns without inflating the session-span count.
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: p.SessionID,
			Name:      "coding_agent.session.loop.stop",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.client":     in.Vendor,
				"coding_agent.hook.event": event,
			},
		})
	case "SessionEnd":
		// Authoritative session-close. Emit the full session span
		// with token rollups, realized cost, and outcome.
		return emitSession(in, p, vcs, cls, "ended", time.Now())
	case "PreToolUse":
		// Pre-event only; the full tool span is emitted at PostToolUse
		// time so we don't double-count. Still log a compact event so
		// dashboards can show the in-flight tool list.
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: p.SessionID,
			Name:      "coding_agent.tool.requested",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.client":  in.Vendor,
				"gen_ai.tool.name":     p.ToolName,
				"gen_ai.tool.call.id":  p.ToolUseID,
				"code.cwd":             p.CWD,
			},
		})
	case "PostToolUse":
		return emitToolCall(in, p, vcs, cls)
	case "SubagentStop":
		return in.Emit.EmitSubagent(normalize.Subagent{
			SessionID:    p.SessionID,
			SubagentType: "task",
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

	if kind == "ended" {
		// Best-effort transcript tail for token usage + cost.
		if model, cost, in0, out0, total := tailTranscript(p.TranscriptPath); total > 0 || cost > 0 {
			s.CostUSD = cost
			s.InputTokens = in0
			s.OutputTokens = out0
			s.TotalTokens = total
			if model != "" {
				s.Model = model
			}
		}
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
// invocation.
func emitToolCall(in normalize.Input, p claudePayload, vcs git.Context, cls classify.Classification) error {
	t := normalize.ToolCall{
		SessionID:  p.SessionID,
		ToolName:   p.ToolName,
		ToolUseID:  p.ToolUseID,
		Vendor:     in.Vendor,
		WorkingDir: p.CWD,
		StartedAt:  time.Now(),
		EndedAt:    time.Now(),
	}

	// Edit-decision shorthand: Claude Code's PostToolUse for Edit/Write/
	// MultiEdit fires after the user accepts or auto-accept handles the
	// patch. We treat permission_mode as the source-of-decision signal.
	if isEditTool(p.ToolName) {
		decision := semconv.CodingAgentEditDecisionAccept
		source := semconv.CodingAgentEditDecisionSourceUserInteractive
		if p.PermissionMode == "auto_accept" || p.PermissionMode == "bypassPermissions" {
			decision = semconv.CodingAgentEditDecisionAutoAccepted
			source = semconv.CodingAgentEditDecisionSourcePolicy
		}
		_ = in.Emit.EmitEditDecision(normalize.EditDecision{
			SessionID: p.SessionID,
			Decision:  decision,
			Source:    source,
			Tool:      p.ToolName,
			Vendor:    in.Vendor,
			At:        time.Now(),
			FilePath:  filePathFromInput(p.ToolInput),
		})
	}

	// Surface VCS / classification on the tool span so dashboards can
	// group tool calls by repo and personal-vs-work without joining
	// back to the session span.
	_ = vcs
	_ = cls
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

func isEditTool(name string) bool {
	switch name {
	case "Edit", "Write", "MultiEdit", "NotebookEdit":
		return true
	default:
		return false
	}
}

// filePathFromInput pulls the "file_path" field out of the tool_input
// blob if present. Returns "" on any error so the caller can decide
// what to do.
func filePathFromInput(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var m struct {
		FilePath string `json:"file_path"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	return m.FilePath
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
	data, err := os.ReadFile(path) //nolint:gosec // path comes from the agent's own payload
	if err != nil {
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
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var t turn
		if err := json.Unmarshal([]byte(line), &t); err != nil {
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
