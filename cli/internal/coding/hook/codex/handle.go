package codex

import (
	"context"
	"encoding/json"
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

// codexPayload mirrors the JSON envelope OpenAI Codex sends to a hook
// command. Field naming follows the protocol as documented at
// https://developers.openai.com/codex/hooks. Unknown fields are
// ignored so Codex can add keys without breaking installs.
type codexPayload struct {
	HookEventName        string          `json:"hook_event_name"`
	SessionID            string          `json:"session_id"`
	TurnID               string          `json:"turn_id"`
	TranscriptPath       string          `json:"transcript_path"`
	Cwd                  string          `json:"cwd"`
	Model                string          `json:"model"`
	Source               string          `json:"source"`
	Prompt               string          `json:"prompt"`
	ToolName             string          `json:"tool_name"`
	ToolUseID            string          `json:"tool_use_id"`
	ToolInput            json.RawMessage `json:"tool_input"`
	ToolResponse         json.RawMessage `json:"tool_response"`
	ToolOutput           json.RawMessage `json:"tool_output"`
	ToolDurationMs       *float64        `json:"tool_duration_ms"`
	DurationMs           *float64        `json:"duration_ms"`
	Status               string          `json:"status"`
	Error                json.RawMessage `json:"error"`
	Timestamp            string          `json:"timestamp"`
	StopHookActive       bool            `json:"stop_hook_active"`
	LastAssistantMessage *string         `json:"last_assistant_message"`

	// ApprovalMode mirrors Codex's `--approval-mode` (`untrusted`,
	// `on-failure`, `on-request`, `never`). Codex doesn't always
	// stamp it, but when it does we treat it as the OTel-canonical
	// `coding_agent.policy.permission_mode`. Older builds called the
	// field `approval_mode`; we accept both.
	ApprovalMode   string `json:"approval_mode"`
	PermissionMode string `json:"permission_mode"`
}

// handle is the per-invocation entry point invoked by `openlit coding hook`.
func handle(ctx context.Context, in normalize.Input) error {
	var p codexPayload
	if err := json.Unmarshal(in.Payload, &p); err != nil {
		return nil
	}

	event := in.Event
	if event == "" {
		event = p.HookEventName
	}

	cwd := strings.TrimSpace(p.Cwd)
	if cwd == "" {
		if wd, err := os.Getwd(); err == nil {
			cwd = wd
		}
	}
	vcs := git.Snapshot(ctx, cwd)
	cls := classify.Classify(classify.Inputs{
		// v1: same posture as the Cursor / Claude Code adapters —
		// no API-key allowlist is wired up at the CLI surface, so
		// we let the classifier lean on the repo signal alone.
		APIKeyAllowlistKnown: false,
		APIKeyOnAllowlist:    false,
		RepoURL:              vcs.RepoURL,
		RepoAllowlist:        classify.SplitAllowlist(os.Getenv("OPENLIT_CODING_REPO_ALLOWLIST")),
	})

	permissionMode := nonEmpty(p.PermissionMode, p.ApprovalMode)

	// Surface subagent linkage as soon as we have it. Codex's
	// transcript carries this in the `session_meta` record, which is
	// at or near the top of the rollout JSONL.
	primeSubagentLink(p)

	switch event {
	case "SessionStart":
		return in.Emit.EmitSession(buildSession(in, p, vcs, cls, permissionMode, cwd, "started", time.Time{}))

	case "UserPromptSubmit":
		stampTurnFragment(p, in.ContentCapture, func(f *sessionstate.CodexTurnFragment) {
			if in.ContentCapture == semconv.CodingAgentContentCaptureFull && p.Prompt != "" {
				f.Prompt = p.Prompt
			}
			if f.StartedAt.IsZero() {
				f.StartedAt = parseEventTime(p.Timestamp)
			}
		})
		// Cheap event so the chat timeline can show "user submitted
		// a prompt" even before Stop fires. The full LLM-turn span
		// is emitted at Stop.
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: p.SessionID,
			Name:      "coding_agent.user_prompt.submit",
			At:        parseEventTime(p.Timestamp),
			Attrs: map[string]any{
				"coding_agent.client":  in.Vendor,
				"coding_agent.turn.id": p.TurnID,
				"code.cwd":             cwd,
				"gen_ai.request.model": p.Model,
			},
		})

	case "PreToolUse":
		// Pre-event only. The authoritative tool span fires at
		// PostToolUse to avoid double-counting.
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: p.SessionID,
			Name:      "coding_agent.tool.requested",
			At:        parseEventTime(p.Timestamp),
			Attrs: map[string]any{
				"coding_agent.client":  in.Vendor,
				"coding_agent.turn.id": p.TurnID,
				"gen_ai.tool.name":     p.ToolName,
				"gen_ai.tool.call.id":  p.ToolUseID,
				"code.cwd":             cwd,
				"gen_ai.request.model": p.Model,
			},
		})

	case "PostToolUse":
		t := buildToolCall(in, p, cwd)
		_ = in.Emit.EmitToolCall(t)
		// Detect agent-attributed git commits / PR creations from
		// shell-style tools. Codex emits `shell` and `local_shell`.
		// We only attribute when the tool completed successfully —
		// a failed git invocation does NOT count toward the commit
		// / PR rollups.
		if normalizeStatus(p) != "error" {
			emitGitArtifactsCodex(in, p, cwd)
		}
		// apply_patch is Codex's edit tool. Parse the patch body
		// into per-file LinesAdded / LinesRemoved counts and emit
		// one EditDecision per file. The decision is `auto_accepted`
		// because Codex applies patches without an interactive
		// review step (the diff is shown but the apply is the
		// default action) — matches today's auto_accept behavior on
		// Cursor's afterFileEdit.
		if isApplyPatchTool(p.ToolName) && normalizeStatus(p) != "error" {
			emitApplyPatchEditDecisions(in, p, cwd)
		}
		// Cache the call on the turn fragment so the Stop event can
		// render it as a `tool_call` / `tool_call_response` part in
		// `gen_ai.input.messages` + `gen_ai.output.messages`.
		stampTurnFragment(p, in.ContentCapture, func(f *sessionstate.CodexTurnFragment) {
			rec := sessionstate.CodexToolRecord{
				ToolName:    p.ToolName,
				ToolUseID:   p.ToolUseID,
				Status:      normalizeStatus(p),
				Cwd:         cwd,
				CompletedAt: p.Timestamp,
				DurationMs:  durationMsOr(p.ToolDurationMs, p.DurationMs),
			}
			if rec.Status == "error" {
				rec.ErrorMessage = errorMessage(p.Error)
			}
			if in.ContentCapture == semconv.CodingAgentContentCaptureFull {
				if len(p.ToolInput) > 0 {
					rec.ToolInput = string(p.ToolInput)
				}
				resp := p.ToolResponse
				if len(resp) == 0 {
					resp = p.ToolOutput
				}
				if len(resp) > 0 {
					rec.ToolResponse = string(resp)
				}
			}
			f.Tools = append(f.Tools, rec)
		})
		return nil

	case "Stop":
		// Stop closes one turn. Drain the turn fragment, tail the
		// transcript for authoritative token usage, and emit one
		// `coding_agent.llm.turn` span — the canonical
		// "generation" record per OTel GenAI.
		emitTurnOnStop(in, p, cwd, permissionMode)
		// Codex has NO `SessionEnd` event — the rollout just ends
		// when the user closes the Codex CLI. We periodically
		// re-emit the session-root span so the Sessions row lights
		// up with up-to-the-turn rollups. Deterministic SpanIDs
		// collapse all re-emits onto the same `otel_traces` row,
		// so this is purely a wire / CPU optimisation; throttle to
		// at most once per ~60s of wall-clock so long Codex
		// sessions (which can fire dozens of Stop events per
		// minute) don't ship a redundant session-root span per
		// turn.
		if shouldEmitCodexSessionRoot(p.SessionID) {
			s := buildSession(in, p, vcs, cls, permissionMode, cwd, "ended", parseEventTime(p.Timestamp))
			s.Outcome = semconv.CodingAgentSessionOutcomeCompleted
			_ = in.Emit.EmitSession(s)
			markCodexSessionRootEmitted(p.SessionID)
		}
		// Low-cost loop event so the Sessions tab can count turns
		// without scanning the LLM-turn span every time.
		return in.Emit.EmitEvent(normalize.EventEmission{
			SessionID: p.SessionID,
			Name:      "coding_agent.session.loop.stop",
			At:        parseEventTime(p.Timestamp),
			Attrs: map[string]any{
				"coding_agent.client":            in.Vendor,
				"coding_agent.hook.event":        event,
				"coding_agent.turn.id":           p.TurnID,
				"coding_agent.session.loop.kind": "assistant_turn_end",
				"coding_agent.session.outcome":   semconv.CodingAgentSessionOutcomeCompleted,
				"codex.stop_hook_active":         p.StopHookActive,
			},
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

// codexSessionRootMinInterval is the minimum wall-clock between
// session-root re-emits during a Codex chat. Deterministic SpanIDs
// collapse repeated emissions onto the same `otel_traces` row, but
// the OTLP send still costs CPU + bytes on every Stop event. 60s is
// a sane middle ground: dashboards refresh fast enough that the
// Sessions row lights up within a single observation cycle, while
// dense back-and-forth sessions don't ship one duplicate root span
// per turn.
const codexSessionRootMinInterval = 60 * time.Second

// shouldEmitCodexSessionRoot reports whether enough wall-clock has
// passed since the last session-root emission for this session to
// justify another. Always allows the first emission (cache miss).
func shouldEmitCodexSessionRoot(sessionID string) bool {
	if sessionID == "" {
		return true
	}
	st := sessionstate.Load(sessionID, "codex")
	if st == nil || st.LastSessionRootEmitAt.IsZero() {
		return true
	}
	return time.Since(st.LastSessionRootEmitAt) >= codexSessionRootMinInterval
}

// markCodexSessionRootEmitted records that we just emitted the
// session-root span so the next Stop within the throttle window
// skips re-emission.
func markCodexSessionRootEmitted(sessionID string) {
	if sessionID == "" {
		return
	}
	st := sessionstate.Load(sessionID, "codex")
	if st == nil {
		st = &sessionstate.State{}
	}
	st.LastSessionRootEmitAt = time.Now()
	sessionstate.Save(sessionID, "codex", st)
}

// buildSession produces the canonical `coding_agent.session` span. We
// emit it on SessionStart. Codex doesn't have a `SessionEnd` event;
// the per-turn `coding_agent.llm.turn` spans accumulate naturally
// and the session row in the UI rolls them up.
func buildSession(
	in normalize.Input,
	p codexPayload,
	vcs git.Context,
	cls classify.Classification,
	permissionMode, cwd, kind string,
	endedAt time.Time,
) normalize.Session {
	s := normalize.Session{
		SessionID:            p.SessionID,
		ConversationID:       p.SessionID,
		Vendor:               in.Vendor,
		Model:                p.Model,
		StartedAt:            parseEventTime(p.Timestamp),
		EndedAt:              endedAt,
		PermissionMode:       permissionMode,
		CWD:                  cwd,
		RepoURL:              vcs.RepoURL,
		HeadSHA:              vcs.HeadSHA,
		BranchName:           vcs.Branch,
		VCSDirty:             vcs.Dirty,
		UserClassification:   cls.Value,
		ClassificationReason: cls.Reason,
		Extras: map[string]string{
			"coding_agent.hook.event": p.HookEventName,
			"codex.session.lifecycle": kind,
		},
	}
	if p.TranscriptPath != "" {
		s.Extras["coding_agent.session.transcript_path"] = p.TranscriptPath
	}
	if p.Source != "" {
		s.Extras["codex.session.source"] = p.Source
	}
	// Carry the subagent-link metadata (if any) onto the session
	// span — the UI uses it to fold this row under the parent chat.
	if st := sessionstate.Load(p.SessionID, "codex"); st != nil && st.CodexSubagent != nil {
		s.Extras["coding_agent.agent.parent_id"] = st.CodexSubagent.ParentSessionID
		s.Extras["coding_agent.subagent.type"] = "task"
		if st.CodexSubagent.AgentRole != "" {
			s.Extras["codex.agent.role"] = st.CodexSubagent.AgentRole
		}
		if st.CodexSubagent.AgentNickname != "" {
			s.Extras["codex.agent.nickname"] = st.CodexSubagent.AgentNickname
		}
	}
	return s
}

// buildToolCall produces a `coding_agent.tool.call` span for one
// PostToolUse event. We mirror the Cursor adapter: name/id/cwd are
// always stamped, bodies (args / result) only land in full capture.
func buildToolCall(in normalize.Input, p codexPayload, cwd string) normalize.ToolCall {
	durMs := durationMsOr(p.ToolDurationMs, p.DurationMs)
	now := parseEventTime(p.Timestamp)
	if now.IsZero() {
		now = time.Now()
	}
	t := normalize.ToolCall{
		SessionID:  p.SessionID,
		ToolName:   p.ToolName,
		ToolUseID:  p.ToolUseID,
		Vendor:     in.Vendor,
		Model:      p.Model,
		WorkingDir: cwd,
		StartedAt:  now.Add(-time.Duration(durMs) * time.Millisecond),
		EndedAt:    now,
	}
	if in.ContentCapture == semconv.CodingAgentContentCaptureFull {
		if len(p.ToolInput) > 0 {
			t.Args = string(p.ToolInput)
		}
		resp := p.ToolResponse
		if len(resp) == 0 {
			resp = p.ToolOutput
		}
		if len(resp) > 0 {
			t.Result = string(resp)
		}
	}
	// Shell / apply_patch are the most common codex tools — expose
	// the command head so dashboards can render "ran: ls" without
	// having to parse JSON.
	if cmd := commandFromToolInput(p.ToolName, p.ToolInput, in.ContentCapture); cmd != "" {
		t.Command = cmd
	}
	if normalizeStatus(p) == "error" {
		t.Errored = true
		t.ErrorMsg = errorMessage(p.Error)
	}
	return t
}

// emitTurnOnStop builds and emits one `coding_agent.llm.turn` span
// from the cached turn fragment + a transcript-derived token snapshot.
// This is the OTel-canonical "generation" record: a single LLM call
// with input messages, output messages, tokens, and cost.
//
// The shape of `gen_ai.input.messages` and `gen_ai.output.messages` is
// produced centrally in `cli/internal/otlp/attrs.go` from the typed
// fields we set here (Prompt, Response). Adapters never serialise
// that JSON themselves — keeping the OTel GenAI spec-compliance check
// in one place. Tool calls + tool results that bracket this turn are
// emitted as their own `coding_agent.tool.call` spans rather than
// folded into the LLM-turn messages JSON, so a single turn's
// messages stay well under the span-attribute size cap regardless of
// how chatty the tool layer was.
func emitTurnOnStop(in normalize.Input, p codexPayload, cwd, permissionMode string) {
	st := sessionstate.Load(p.SessionID, "codex")
	if st == nil {
		st = &sessionstate.State{}
	}
	frag := loadTurnFragment(st, p.TurnID)
	if frag == nil {
		frag = &sessionstate.CodexTurnFragment{TurnID: p.TurnID}
	}
	if p.Model != "" {
		frag.Model = p.Model
	}
	if p.Source != "" {
		frag.Source = p.Source
	}
	frag.StopHookActive = p.StopHookActive
	if in.ContentCapture == semconv.CodingAgentContentCaptureFull &&
		p.LastAssistantMessage != nil && *p.LastAssistantMessage != "" {
		frag.LastAssistantMessage = *p.LastAssistantMessage
	}

	completedAt := parseEventTime(p.Timestamp)
	if completedAt.IsZero() {
		completedAt = time.Now()
	}
	startedAt := frag.StartedAt
	if startedAt.IsZero() {
		startedAt = completedAt
	}

	turn := normalize.LLMTurn{
		SessionID:      p.SessionID,
		ConversationID: p.SessionID,
		GenerationID:   p.TurnID,
		Vendor:         in.Vendor,
		Model:          frag.Model,
		StartedAt:      startedAt,
		EndedAt:        completedAt,
	}

	// Token usage: prefer the transcript-derived per-turn delta —
	// subtract the pre-model baseline from the final cumulative.
	transcriptPath := strings.TrimSpace(p.TranscriptPath)
	if transcriptPath == "" {
		// Fallback: scan ~/.codex/sessions for a rollout whose
		// first line contains our session id. We look at today +
		// yesterday so wrapped-midnight sessions still attribute
		// usage.
		transcriptPath = findRolloutForSession(p.SessionID)
	}
	if snap, ok := readTokenUsageForTurn(transcriptPath, p.TurnID); ok {
		turn.InputTokens = snap.TurnUsage.InputTokens
		turn.OutputTokens = snap.TurnUsage.OutputTokens
		turn.TotalTokens = snap.TurnUsage.TotalTokens
		if turn.TotalTokens == 0 {
			turn.TotalTokens = turn.InputTokens + turn.OutputTokens
		}
		turn.CacheReadTokens = snap.TurnUsage.CachedInputTokens
		if rate := pricing.Lookup(turn.Model); turn.Model != "" {
			// OpenAI's prompt caching is implicit — the rollout
			// only surfaces `cached_input_tokens` (reads). There
			// is no separate cache-write counter, so we pass 0
			// for cacheCreation.
			turn.CostUSD = rate.Cost(turn.InputTokens, turn.OutputTokens, turn.CacheReadTokens, 0)
		}
		if snap.TurnUsage.ReasoningOutputTokens > 0 {
			if turn.Extras == nil {
				turn.Extras = map[string]string{}
			}
			turn.Extras["coding_agent.llm.reasoning.tokens"] = formatInt(snap.TurnUsage.ReasoningOutputTokens)
		}
	}

	turn.FinishReasons = []string{"stop"}
	// Codex doesn't expose the cumulative input separately from
	// cached input; surface the model context window when we have it
	// so dashboards can show "headroom" pills.
	if turn.Extras == nil {
		turn.Extras = map[string]string{}
	}
	if frag.Source != "" {
		turn.Extras["codex.source"] = frag.Source
	}
	if cwd != "" {
		turn.Extras["code.cwd"] = cwd
	}
	if permissionMode != "" {
		turn.Extras["coding_agent.policy.permission_mode"] = permissionMode
	}
	if frag.StopHookActive {
		turn.Extras["codex.stop_hook_active"] = "true"
	}
	if st.CodexSubagent != nil && st.CodexSubagent.ParentSessionID != "" {
		turn.Extras["coding_agent.agent.parent_id"] = st.CodexSubagent.ParentSessionID
		turn.Extras["coding_agent.subagent.type"] = "task"
	}
	if len(turn.Extras) == 0 {
		turn.Extras = nil
	}

	if in.ContentCapture == semconv.CodingAgentContentCaptureFull {
		if s := strings.TrimSpace(frag.Prompt); s != "" {
			turn.Prompt = s
		}
		if s := strings.TrimSpace(frag.LastAssistantMessage); s != "" {
			turn.Response = s
		}
		// Tool calls + tool results are captured as their own
		// `coding_agent.tool.call` spans (with
		// `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result`)
		// at PreToolUse / PostToolUse time. We deliberately do NOT
		// duplicate them onto the LLM-turn messages JSON; the chat
		// view interleaves the two span kinds by timestamp.
	}

	_ = in.Emit.EmitLLMTurn(turn)

	// Drain the turn fragment — it's served its purpose. We keep the
	// session state itself so the next turn (still in this session)
	// finds the cached subagent link and identity.
	clearTurnFragment(st, p.TurnID)
	sessionstate.Save(p.SessionID, "codex", st)
}

// stampTurnFragment loads or creates the turn fragment for `p.TurnID`,
// applies the caller's mutation, then persists. We bound CodexTurns to
// 16 entries so a marathon session doesn't grow the on-disk cache
// unboundedly. The Stop event drains its own fragment.
func stampTurnFragment(p codexPayload, capture string, mutate func(*sessionstate.CodexTurnFragment)) {
	if p.SessionID == "" || p.TurnID == "" {
		return
	}
	_ = capture // reserved — gated content has already been filtered at the call site
	st := sessionstate.Load(p.SessionID, "codex")
	if st == nil {
		st = &sessionstate.State{}
	}
	if st.CodexTurns == nil {
		st.CodexTurns = map[string]*sessionstate.CodexTurnFragment{}
	}
	f, ok := st.CodexTurns[p.TurnID]
	if !ok {
		f = &sessionstate.CodexTurnFragment{TurnID: p.TurnID, StartedAt: parseEventTime(p.Timestamp)}
		st.CodexTurns[p.TurnID] = f
	}
	if f.Model == "" && p.Model != "" {
		f.Model = p.Model
	}
	if f.Source == "" && p.Source != "" {
		f.Source = p.Source
	}
	mutate(f)
	pruneTurnFragments(st)
	sessionstate.Save(p.SessionID, "codex", st)
}

// pruneTurnFragments keeps the per-session map at 16 entries. We pick
// the oldest by StartedAt; ties on the zero value drop arbitrarily,
// which is safe because every fragment is independently drainable on
// its own Stop event.
func pruneTurnFragments(st *sessionstate.State) {
	const cap = 16
	if len(st.CodexTurns) <= cap {
		return
	}
	type ageKey struct {
		key string
		t   time.Time
	}
	ages := make([]ageKey, 0, len(st.CodexTurns))
	for k, v := range st.CodexTurns {
		ages = append(ages, ageKey{key: k, t: v.StartedAt})
	}
	// stable enough — sort ascending so the oldest sort to the front
	for i := 1; i < len(ages); i++ {
		for j := i; j > 0 && ages[j-1].t.After(ages[j].t); j-- {
			ages[j-1], ages[j] = ages[j], ages[j-1]
		}
	}
	for i := 0; i < len(ages)-cap; i++ {
		delete(st.CodexTurns, ages[i].key)
	}
}

func loadTurnFragment(st *sessionstate.State, turnID string) *sessionstate.CodexTurnFragment {
	if st == nil || st.CodexTurns == nil {
		return nil
	}
	return st.CodexTurns[turnID]
}

func clearTurnFragment(st *sessionstate.State, turnID string) {
	if st == nil || st.CodexTurns == nil {
		return
	}
	delete(st.CodexTurns, turnID)
	if len(st.CodexTurns) == 0 {
		st.CodexTurns = nil
	}
}

// primeSubagentLink reads the transcript's `session_meta` block once
// per session and caches the parent linkage. Cheap because we only
// scan to the first matching line; idempotent because subsequent calls
// return early when the cache is already populated.
func primeSubagentLink(p codexPayload) {
	if p.SessionID == "" {
		return
	}
	st := sessionstate.Load(p.SessionID, "codex")
	if st == nil {
		st = &sessionstate.State{}
	}
	if st.CodexSubagent != nil {
		return
	}
	path := strings.TrimSpace(p.TranscriptPath)
	if path == "" {
		path = findRolloutForSession(p.SessionID)
	}
	if path == "" {
		return
	}
	meta, ok := readSessionMeta(path)
	if !ok || meta.ThreadSource != "subagent" || meta.ParentSessionID == "" {
		return
	}
	st.CodexSubagent = &sessionstate.CodexSubagentLink{
		ParentSessionID: meta.ParentSessionID,
		AgentRole:       meta.AgentRole,
		AgentNickname:   meta.AgentNickname,
		AgentDepth:      meta.AgentDepth,
	}
	sessionstate.Save(p.SessionID, "codex", st)
}

// normalizeStatus maps Codex's PostToolUse `status` / `error` /
// response-shape signals onto our `completed` / `error` enum.
func normalizeStatus(p codexPayload) string {
	if s := canonicalStatus(p.Status); s != "" {
		return s
	}
	if hasErrorEvidence(p.Error) {
		return "error"
	}
	resp := p.ToolResponse
	if len(resp) == 0 {
		resp = p.ToolOutput
	}
	if s := statusFromToolResponse(resp); s != "" {
		return s
	}
	return ""
}

func canonicalStatus(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "error", "failed", "failure":
		return "error"
	case "completed", "complete", "success", "succeeded", "ok":
		return "completed"
	}
	return ""
}

func hasErrorEvidence(raw json.RawMessage) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return false
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return true
	}
	return !emptyJSONValue(v)
}

func statusFromToolResponse(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return ""
	}
	return statusFromValue(v)
}

func statusFromValue(v any) string {
	switch x := v.(type) {
	case map[string]any:
		for _, key := range []string{"status", "state"} {
			if s := canonicalStatus(stringField(x, key)); s != "" {
				return s
			}
		}
		for _, key := range []string{"is_error", "isError"} {
			if b, ok := boolField(x, key); ok {
				if b {
					return "error"
				}
				return "completed"
			}
		}
		if b, ok := boolField(x, "success"); ok {
			if b {
				return "completed"
			}
			return "error"
		}
		for _, key := range []string{"exit_code", "exitCode"} {
			if code, ok := numberField(x, key); ok {
				if code == 0 {
					return "completed"
				}
				return "error"
			}
		}
		// Positive signal: a non-empty tool response with no
		// explicit error / success / exit_code field is most often
		// a successful tool call that simply returned a plain
		// payload (Codex's `read_file` is a common shape — just a
		// `{ "content": "..." }` body). Treating these as
		// completed lets dashboards show "✓ tool" instead of a
		// faded "unknown" pill. We deliberately only do this when
		// there's at least one field — an empty map is still
		// unknown.
		if len(x) > 0 {
			return "completed"
		}
	case string:
		return canonicalStatus(x)
	}
	return ""
}

func emptyJSONValue(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case bool:
		return !x
	case string:
		return strings.TrimSpace(x) == ""
	case float64:
		return x == 0
	case []any:
		return len(x) == 0
	case map[string]any:
		return len(x) == 0
	}
	return false
}

func stringField(m map[string]any, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func boolField(m map[string]any, key string) (bool, bool) {
	v, ok := m[key]
	if !ok {
		return false, false
	}
	b, ok := v.(bool)
	return b, ok
}

func numberField(m map[string]any, key string) (float64, bool) {
	v, ok := m[key]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	}
	return 0, false
}

func errorMessage(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var obj struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &obj); err == nil && obj.Message != "" {
		return obj.Message
	}
	return string(raw)
}

// commandFromToolInput peeks at Codex's `tool_input` to pull the
// canonical command string for shell / apply_patch tools. In metadata
// or minimal mode we keep only the binary head so the trace-detail
// "Shell" pill still works without leaking flags. Full mode returns
// the entire command.
func commandFromToolInput(toolName string, raw json.RawMessage, capture string) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	pickStr := func(keys ...string) string {
		for _, k := range keys {
			v, ok := m[k]
			if !ok {
				continue
			}
			var s string
			if err := json.Unmarshal(v, &s); err == nil && s != "" {
				return s
			}
		}
		return ""
	}
	cmd := ""
	switch strings.ToLower(toolName) {
	case "shell", "local_shell", "local-shell":
		cmd = pickStr("command", "cmd", "shell")
		if cmd == "" {
			// some shells ship an array — fall back to joining
			if arr, ok := m["command"]; ok {
				var parts []string
				if err := json.Unmarshal(arr, &parts); err == nil {
					cmd = strings.Join(parts, " ")
				}
			}
		}
	case "apply_patch", "apply-patch":
		// apply_patch carries a diff — surface the first hunk header
		// so dashboards can show "edited <file>" without leaking the
		// patch body.
		if patch := pickStr("input", "patch"); patch != "" {
			for _, line := range strings.Split(patch, "\n") {
				if strings.HasPrefix(line, "*** ") {
					return strings.TrimSpace(line)
				}
			}
		}
	}
	if cmd == "" {
		return ""
	}
	cmd = strings.TrimSpace(cmd)
	if capture == semconv.CodingAgentContentCaptureFull {
		return cmd
	}
	if i := strings.IndexAny(cmd, " \t"); i > 0 {
		return cmd[:i]
	}
	return cmd
}

// isApplyPatchTool reports whether the tool name is Codex's edit tool.
func isApplyPatchTool(name string) bool {
	return strings.ToLower(name) == "apply_patch"
}

// emitApplyPatchEditDecisions parses Codex's apply_patch input into
// per-file unified-diff line counts and emits one EditDecision span
// per file. The session-state LOC / accept counters are bumped at the
// same time so the session-root span (re-emitted on Stop) carries the
// running rollups.
func emitApplyPatchEditDecisions(in normalize.Input, p codexPayload, cwd string) {
	patch := applyPatchBody(p.ToolInput)
	if patch == "" {
		return
	}
	counts := detect.CountPatchLines(patch)
	if len(counts) == 0 {
		return
	}
	now := parseEventTime(p.Timestamp)
	if now.IsZero() {
		now = time.Now()
	}
	var totalAdded, totalRemoved int
	for _, c := range counts {
		_ = in.Emit.EmitEditDecision(normalize.EditDecision{
			SessionID:    p.SessionID,
			Decision:     semconv.CodingAgentEditDecisionAutoAccepted,
			Source:       semconv.CodingAgentEditDecisionSourcePolicy,
			Tool:         "apply_patch",
			Language:     guessLanguageCodex(c.FilePath),
			LinesAdded:   c.LinesAdded,
			LinesRemoved: c.LinesRemoved,
			FilePath:     c.FilePath,
			Vendor:       in.Vendor,
			At:           now,
		})
		totalAdded += c.LinesAdded
		totalRemoved += c.LinesRemoved
	}
	if totalAdded > 0 || totalRemoved > 0 {
		sessionstate.BumpCodeCounters(p.SessionID, in.Vendor, totalAdded, totalRemoved, totalAdded, 0, len(counts), 0)
	}
	_ = cwd
}

// applyPatchBody extracts the patch text from Codex's apply_patch
// tool_input. Tries `input`, `patch`, and `diff` field names — Codex
// has shipped each in different rollout versions.
func applyPatchBody(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	for _, k := range []string{"input", "patch", "diff"} {
		v, ok := m[k]
		if !ok || len(v) == 0 {
			continue
		}
		var s string
		if err := json.Unmarshal(v, &s); err == nil && s != "" {
			return s
		}
	}
	return ""
}

// emitGitArtifactsCodex inspects Codex's shell-style tool input/output
// and emits GitCommit / GitPullRequest spans + bumps the counters when
// the command matched. Codex packs the shell tool's command in
// `tool_input.command` (string OR array of strings) and the stdout in
// `tool_response` / `tool_output`.
func emitGitArtifactsCodex(in normalize.Input, p codexPayload, cwd string) {
	if !isShellTool(p.ToolName) {
		return
	}
	cmd := shellCommand(p.ToolInput)
	if cmd == "" {
		return
	}
	stdout := shellStdout(p.ToolResponse, p.ToolOutput)
	now := parseEventTime(p.Timestamp)
	if now.IsZero() {
		now = time.Now()
	}
	if detect.IsGitCommit(cmd) {
		message := ""
		if in.ContentCapture == semconv.CodingAgentContentCaptureFull {
			message = detect.ExtractCommitMessage(cmd)
		}
		_ = in.Emit.EmitGitCommit(normalize.GitCommit{
			SessionID:  p.SessionID,
			Vendor:     in.Vendor,
			Tool:       p.ToolName,
			SHA:        detect.ExtractCommitSHA(stdout),
			Message:    message,
			WorkingDir: cwd,
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
			Tool:       p.ToolName,
			URL:        url,
			Number:     num,
			Title:      title,
			WorkingDir: cwd,
			At:         now,
		})
		sessionstate.BumpPRCount(p.SessionID, in.Vendor)
	}
}

func isShellTool(name string) bool {
	switch strings.ToLower(name) {
	case "shell", "local_shell", "local-shell":
		return true
	}
	return false
}

// shellCommand pulls the command string from Codex's shell tool
// input. The field is sometimes a plain string, sometimes an array.
func shellCommand(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	for _, k := range []string{"command", "cmd", "shell"} {
		v, ok := m[k]
		if !ok || len(v) == 0 {
			continue
		}
		var s string
		if err := json.Unmarshal(v, &s); err == nil && s != "" {
			return s
		}
		var arr []string
		if err := json.Unmarshal(v, &arr); err == nil && len(arr) > 0 {
			return strings.Join(arr, " ")
		}
	}
	return ""
}

// shellStdout extracts a string stdout body from Codex's tool
// response. Tries `tool_response` first (newer rollouts) then
// `tool_output`. Both have shipped as either a plain string or
// `{"output":"..."}` / `{"stdout":"..."}`.
func shellStdout(resp, out json.RawMessage) string {
	for _, raw := range []json.RawMessage{resp, out} {
		if len(raw) == 0 {
			continue
		}
		var s string
		if err := json.Unmarshal(raw, &s); err == nil && s != "" {
			return s
		}
		var m struct {
			Output string `json:"output"`
			Stdout string `json:"stdout"`
		}
		if err := json.Unmarshal(raw, &m); err == nil {
			if m.Output != "" {
				return m.Output
			}
			if m.Stdout != "" {
				return m.Stdout
			}
		}
	}
	return ""
}

// guessLanguageCodex maps a file extension onto a language tag for
// the edit-decision metric. Returns "" when the extension isn't
// recognised so dashboards can group those into "other".
func guessLanguageCodex(filePath string) string {
	if filePath == "" {
		return ""
	}
	idx := strings.LastIndex(filePath, ".")
	if idx < 0 || idx == len(filePath)-1 {
		return ""
	}
	switch strings.ToLower(filePath[idx:]) {
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
	case ".rb":
		return "ruby"
	case ".php":
		return "php"
	case ".c", ".h":
		return "c"
	case ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx":
		return "cpp"
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
	case ".html", ".htm":
		return "html"
	case ".css", ".scss", ".sass":
		return "css"
	}
	return ""
}

func parseEventTime(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Now()
	}
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t
	}
	return time.Now()
}

func durationMsOr(primary, secondary *float64) int64 {
	if primary != nil && *primary > 0 {
		return int64(*primary)
	}
	if secondary != nil && *secondary > 0 {
		return int64(*secondary)
	}
	return 0
}

func nonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func formatInt(n int64) string {
	if n == 0 {
		return "0"
	}
	// avoid pulling in strconv for one call site
	return jsonNumberString(n)
}

// jsonNumberString stringifies an int64 by marshalling through
// encoding/json — cheap and avoids a strconv import for the one
// numeric tag we render today.
func jsonNumberString(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
