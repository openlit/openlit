package codex

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/classify"
	"github.com/openlit/openlit/cli/internal/coding/git"
	"github.com/openlit/openlit/cli/internal/coding/normalize"
)

// codexPayload covers the fields Codex's hook protocol exposes. Codex
// sends a JSON envelope on stdin per event.
type codexPayload struct {
	Event       string          `json:"event"`        // SessionStart | UserPromptSubmit | PostToolUse | Stop
	SessionID   string          `json:"session_id"`
	Cwd         string          `json:"cwd"`
	ToolName    string          `json:"tool_name"`
	ToolArgs    json.RawMessage `json:"tool_args"`
	Permission  string          `json:"approval_mode"` // matches Codex's --approval-mode flag
	UserID      string          `json:"user_id"`
}

func handle(ctx context.Context, in normalize.Input) error {
	var p codexPayload
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
	case "SessionStart":
		return in.Emit.EmitSession(buildSession(in, p, vcs, cls, "started", time.Time{}))
	case "Stop":
		// Tail the day's rollout JSONL for token totals before
		// emitting the closing span.
		s := buildSession(in, p, vcs, cls, "ended", time.Now())
		if r := tailRollout(p.SessionID); r.total > 0 {
			s.InputTokens = r.input
			s.OutputTokens = r.output
			s.TotalTokens = r.total
		}
		return in.Emit.EmitSession(s)
	case "UserPromptSubmit":
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: p.SessionID,
			Name:      "coding_agent.user_prompt.submit",
			At:        time.Now(),
			Attrs: map[string]any{
				"coding_agent.client": in.Vendor,
			},
		})
	case "PostToolUse":
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
		return in.Emit.EmitToolCall(t)
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
	p codexPayload,
	vcs git.Context,
	cls classify.Classification,
	kind string,
	endedAt time.Time,
) normalize.Session {
	s := normalize.Session{
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
			"codex.session.lifecycle":   kind,
		},
	}
	return s
}

// rolloutTotals is the result of tailing ~/.codex/sessions/<date>/rollout-*.jsonl.
type rolloutTotals struct {
	input, output, total int64
}

// tailRollout walks today's Codex session rollout files looking for
// the most recent rollout-*.jsonl whose first line contains the given
// session id. It then sums the usage records.
//
// We deliberately use today's tree only — the Stop event fires within
// the same calendar day as the session start, and walking older trees
// would slow the hook for no benefit.
func tailRollout(sessionID string) rolloutTotals {
	if sessionID == "" {
		return rolloutTotals{}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return rolloutTotals{}
	}
	day := time.Now().UTC().Format("2006/01/02")
	dir := filepath.Join(home, ".codex", "sessions", day)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return rolloutTotals{}
	}
	// Sort entries by mtime desc so we hit the most recent first.
	sort.Slice(entries, func(i, j int) bool {
		ii, _ := entries[i].Info()
		jj, _ := entries[j].Info()
		return ii.ModTime().After(jj.ModTime())
	})

	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(e.Name(), "rollout-") || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		body, readErr := os.ReadFile(path) //nolint:gosec // path under ~/.codex
		if readErr != nil {
			continue
		}
		// First line of the rollout has the session metadata.
		lines := strings.Split(string(body), "\n")
		if len(lines) == 0 || !strings.Contains(lines[0], sessionID) {
			continue
		}
		var totals rolloutTotals
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var rec struct {
				Type    string `json:"type"`
				Payload struct {
					Usage struct {
						InputTokens  int64 `json:"input_tokens"`
						OutputTokens int64 `json:"output_tokens"`
						TotalTokens  int64 `json:"total_tokens"`
					} `json:"usage"`
				} `json:"payload"`
			}
			if err := json.Unmarshal([]byte(line), &rec); err != nil {
				continue
			}
			totals.input += rec.Payload.Usage.InputTokens
			totals.output += rec.Payload.Usage.OutputTokens
		}
		totals.total = totals.input + totals.output
		return totals
	}
	return rolloutTotals{}
}
