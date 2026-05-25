package copilot

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
)

// copilotPayload covers GitHub Copilot CLI's hook envelope. Copilot
// exposes 10 hook events (sessionStart, userPromptSubmit, preToolUse,
// postToolUse, stop, sessionEnd, mcpInvoke, edit, etc.).
type copilotPayload struct {
	Event       string          `json:"hook_event_name"`
	SessionID   string          `json:"session_id"`
	Cwd         string          `json:"cwd"`
	ToolName    string          `json:"tool_name"`
	ToolArgs    json.RawMessage `json:"tool_input"`
	UserID      string          `json:"user"`
	Permission  string          `json:"permission_mode"`
	FilePath    string          `json:"file_path"`
	LinesAdded  int             `json:"lines_added"`
	LinesRemoved int            `json:"lines_removed"`
}

func handle(ctx context.Context, in normalize.Input) error {
	var p copilotPayload
	if err := json.Unmarshal(in.Payload, &p); err != nil {
		return nil
	}
	event := in.Event
	if event == "" {
		event = p.Event
	}

	vcs := git.Snapshot(ctx, p.Cwd)
	// See cursor/handle.go for the rationale — v1 has no API-key
	// allowlist surface, so we flag the key signal as unknown.
	cls := classify.Classify(classify.Inputs{
		APIKeyAllowlistKnown: false,
		APIKeyOnAllowlist:    false,
		RepoURL:              vcs.RepoURL,
		RepoAllowlist:        classify.SplitAllowlist(os.Getenv("OPENLIT_CODING_REPO_ALLOWLIST")),
	})

	switch event {
	case "sessionStart":
		return in.Emit.EmitSession(buildSession(in, p, vcs, cls, "started", time.Time{}))
	case "stop", "sessionEnd":
		s := buildSession(in, p, vcs, cls, "ended", time.Now())
		if r := tailEvents(p.SessionID); r.total > 0 {
			s.InputTokens = r.input
			s.OutputTokens = r.output
			s.TotalTokens = r.total
		}
		return in.Emit.EmitSession(s)
	case "userPromptSubmit":
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: p.SessionID,
			Name:      "coding_agent.user_prompt.submit",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.client": in.Vendor,
			},
		})
	case "preToolUse":
		return in.Emit.EmitToolCall(buildToolCall(in, p))
	case "postToolUse":
		return in.Emit.EmitToolCall(buildToolCall(in, p))
	case "edit":
		return in.Emit.EmitEditDecision(normalize.EditDecision{
			SessionID:    p.SessionID,
			Decision:     editDecision(p.Permission),
			Source:       editSource(p.Permission),
			Tool:         "edit",
			LinesAdded:   p.LinesAdded,
			LinesRemoved: p.LinesRemoved,
			FilePath:     p.FilePath,
			Vendor:       in.Vendor,
			At:           time.Now(),
		})
	default:
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

func buildSession(
	in normalize.Input,
	p copilotPayload,
	vcs git.Context,
	cls classify.Classification,
	kind string,
	endedAt time.Time,
) normalize.Session {
	return normalize.Session{
		SessionID:            p.SessionID,
		ConversationID:       p.SessionID,
		Vendor:               in.Vendor,
		StartedAt:            time.Now(),
		EndedAt:              endedAt,
		PermissionMode:       p.Permission,
		UserID:               p.UserID,
		RepoURL:              vcs.RepoURL,
		HeadSHA:              vcs.HeadSHA,
		BranchName:           vcs.Branch,
		VCSDirty:             vcs.Dirty,
		UserClassification:   cls.Value,
		ClassificationReason: cls.Reason,
		Extras: map[string]string{
			"coding_agent.hook.event":   p.Event,
			"copilot.session.lifecycle": kind,
		},
	}
}

func buildToolCall(in normalize.Input, p copilotPayload) normalize.ToolCall {
	t := normalize.ToolCall{
		SessionID: p.SessionID,
		ToolName:  p.ToolName,
		Vendor:    in.Vendor,
		StartedAt: time.Now(),
		EndedAt:   time.Now(),
	}
	if in.ContentCapture == "full" && len(p.ToolArgs) > 0 {
		t.Args = string(p.ToolArgs)
	}
	return t
}

func editDecision(permission string) string {
	switch permission {
	case "auto_accept", "yolo", "permissive":
		return "auto_accepted"
	default:
		return "accept"
	}
}

func editSource(permission string) string {
	switch permission {
	case "auto_accept", "yolo", "permissive":
		return "policy"
	default:
		return "user_interactive"
	}
}

// eventTotals captures the aggregated token usage for a Copilot session.
type eventTotals struct {
	input, output, total int64
}

// tailEvents reads ~/.copilot/session-state/<id>/events.jsonl and sums
// the assistant turn usage records.
func tailEvents(sessionID string) eventTotals {
	if sessionID == "" {
		return eventTotals{}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return eventTotals{}
	}
	path := filepath.Join(home, ".copilot", "session-state", sessionID, "events.jsonl")
	body, err := os.ReadFile(path) //nolint:gosec // path under ~/.copilot
	if err != nil {
		return eventTotals{}
	}
	var totals eventTotals
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var rec struct {
			Type  string `json:"type"`
			Usage struct {
				InputTokens  int64 `json:"input_tokens"`
				OutputTokens int64 `json:"output_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			continue
		}
		totals.input += rec.Usage.InputTokens
		totals.output += rec.Usage.OutputTokens
	}
	totals.total = totals.input + totals.output
	return totals
}
