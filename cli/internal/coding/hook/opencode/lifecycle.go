package opencode

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/git"
	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/coding/sessionstate"
	"github.com/openlit/openlit/sdk/go/semconv"
)

type payloadEnvelope struct {
	Event struct {
		Type       string          `json:"type"`
		Properties json.RawMessage `json:"properties"`
	} `json:"event"`
	Directory string `json:"directory"`
	Worktree  string `json:"worktree"`
}

type eventHandler func(context.Context, normalize.Input, payloadEnvelope) error

var eventHandlers = map[string]eventHandler{
	"session.created": handleSessionCreated,
	"session.idle":    handleSessionIdle,
	"session.error":   handleSessionError,
	"session.deleted": handleSessionDeleted,
}

type sessionInfo struct {
	ID        string `json:"id"`
	Directory string `json:"directory"`
	ParentID  string `json:"parentID"`
	Version   string `json:"version"`
	Time      struct {
		Created int64 `json:"created"`
	} `json:"time"`
}

type sessionCreatedProperties struct {
	Info sessionInfo `json:"info"`
}

type sessionIDProperties struct {
	SessionID string `json:"sessionID"`
}

type sessionErrorProperties struct {
	SessionID string `json:"sessionID"`
	ErrorName string `json:"errorName"`
}

func handlePayload(ctx context.Context, in normalize.Input) error {
	var payload payloadEnvelope
	if err := json.Unmarshal(in.Payload, &payload); err != nil {
		return nil
	}
	event := firstNonEmpty(payload.Event.Type, in.Event)
	if handler := eventHandlers[event]; handler != nil {
		return handler(ctx, in, payload)
	}
	// Unknown OpenCode events are intentionally dropped. Emitting a generic
	// span here would either violate the required session-id convention or
	// guess a session association that the payload does not guarantee.
	return nil
}

func handleSessionCreated(ctx context.Context, in normalize.Input, payload payloadEnvelope) error {
	var properties sessionCreatedProperties
	if err := json.Unmarshal(payload.Event.Properties, &properties); err != nil {
		return nil
	}
	info := properties.Info
	sessionID := strings.TrimSpace(info.ID)
	if sessionID == "" {
		return nil
	}

	startedAt := time.Now()
	if info.Time.Created > 0 {
		startedAt = time.UnixMilli(info.Time.Created)
	}
	cwd := firstNonEmpty(info.Directory, payload.Directory, payload.Worktree)
	state := sessionstate.Load(sessionID, in.Vendor)
	if state.SessionStartedAt.IsZero() {
		state.SessionStartedAt = startedAt
	}
	state.ConversationID = sessionID
	if cwd != "" {
		state.CWD = cwd
	}
	if info.ParentID != "" {
		state.ParentConversationID = info.ParentID
	}
	if cwd != "" && (state.RepoURL == "" || state.Branch == "") {
		vcs := git.Snapshot(ctx, cwd)
		if state.RepoURL == "" {
			state.RepoURL = vcs.RepoURL
		}
		if state.Branch == "" {
			state.Branch = vcs.Branch
		}
	}
	sessionstate.Save(sessionID, in.Vendor, state)

	attrs := map[string]any{
		semconv.CodingAgentClient:    in.Vendor,
		semconv.CodingAgentHookEvent: "session.created",
	}
	if info.Version != "" {
		attrs[semconv.CodingAgentClientVersion] = info.Version
	}
	if info.ParentID != "" {
		attrs[semconv.CodingAgentAgentParentID] = info.ParentID
	}
	eventName := semconv.CodingAgentEventSessionStart
	if in.ContentCapture == semconv.CodingAgentContentCaptureMinimal {
		eventName = semconv.CodingAgentEventSessionSnapshotStart
	}
	return in.Emit.EmitEvent(normalize.EventEmission{
		SessionID: sessionID,
		Name:      eventName,
		At:        startedAt,
		Attrs:     attrs,
	})
}

// OpenCode publishes session.idle after every run loop, including error and
// cancellation paths. It is a turn boundary, not a terminal SessionEnd.
func handleSessionIdle(_ context.Context, in normalize.Input, payload payloadEnvelope) error {
	var properties sessionIDProperties
	if err := json.Unmarshal(payload.Event.Properties, &properties); err != nil {
		return nil
	}
	sessionID := strings.TrimSpace(properties.SessionID)
	if sessionID == "" {
		return nil
	}
	if in.ContentCapture == semconv.CodingAgentContentCaptureMinimal {
		return emitMinimalSessionSnapshot(in, sessionID, "session.idle")
	}
	return in.Emit.EmitEvent(normalize.EventEmission{
		SessionID: sessionID,
		Name:      "coding_agent.session.loop.stop",
		At:        time.Now(),
		Attrs: map[string]any{
			semconv.CodingAgentClient:    in.Vendor,
			semconv.CodingAgentHookEvent: "session.idle",
		},
	})
}

func emitMinimalSessionSnapshot(in normalize.Input, sessionID, hookEvent string) error {
	state := sessionstate.Load(sessionID, in.Vendor)
	inputDelta := nonNegative(state.InputTokens - state.OpenCodeSnapshotInputTokens)
	outputDelta := nonNegative(state.OutputTokens - state.OpenCodeSnapshotOutputTokens)
	totalDelta := nonNegative(state.TotalTokens - state.OpenCodeSnapshotTotalTokens)
	costDelta := state.CostUSD - state.OpenCodeSnapshotCostUSD
	if costDelta < 0 {
		costDelta = 0
	}
	now := time.Now()
	duration := int64(0)
	if !state.SessionStartedAt.IsZero() && state.SessionStartedAt.Before(now) {
		duration = now.Sub(state.SessionStartedAt).Milliseconds()
	}
	attrs := map[string]any{
		semconv.CodingAgentClient:               in.Vendor,
		semconv.CodingAgentHookEvent:            hookEvent,
		semconv.CodingAgentSessionDurationMs:    duration,
		semconv.CodingAgentSessionToolCallCount: state.ToolCallCount,
		semconv.GenAIUsageInputTokens:           inputDelta,
		semconv.GenAIUsageOutputTokens:          outputDelta,
		semconv.GenAIUsageTotalTokens:           totalDelta,
		semconv.GenAIUsageCost:                  costDelta,
	}
	if state.OpenCodePendingErrorType != "" {
		attrs[semconv.ErrorType] = state.OpenCodePendingErrorType
	}
	state.OpenCodeSnapshotInputTokens = state.InputTokens
	state.OpenCodeSnapshotOutputTokens = state.OutputTokens
	state.OpenCodeSnapshotTotalTokens = state.TotalTokens
	state.OpenCodeSnapshotCostUSD = state.CostUSD
	state.OpenCodePendingErrorType = ""
	sessionstate.Save(sessionID, in.Vendor, state)
	return in.Emit.EmitEvent(normalize.EventEmission{
		SessionID: sessionID,
		Name:      semconv.CodingAgentEventSessionSnapshot,
		At:        now,
		Attrs:     attrs,
	})
}

func handleSessionError(_ context.Context, in normalize.Input, payload payloadEnvelope) error {
	var properties sessionErrorProperties
	if err := json.Unmarshal(payload.Event.Properties, &properties); err != nil {
		return nil
	}
	sessionID := strings.TrimSpace(properties.SessionID)
	if sessionID == "" {
		return nil
	}
	attrs := map[string]any{
		semconv.CodingAgentClient:    in.Vendor,
		semconv.CodingAgentHookEvent: "session.error",
	}
	errorName := strings.TrimSpace(properties.ErrorName)
	if errorName != "" {
		attrs[semconv.ErrorType] = errorName
	}
	if in.ContentCapture == semconv.CodingAgentContentCaptureMinimal {
		if errorName != "" {
			state := sessionstate.Load(sessionID, in.Vendor)
			state.OpenCodePendingErrorType = errorName
			sessionstate.Save(sessionID, in.Vendor, state)
		}
		// Some OpenCode error paths (for example failed automatic
		// compaction) return without publishing a following idle event.
		// Flush a safe snapshot immediately so minimal mode does not lose
		// the error boundary; the snapshot advances deltas and consumes any
		// pending type, making a later idle refresh idempotent.
		return emitMinimalSessionSnapshot(in, sessionID, "session.error")
	}
	return in.Emit.EmitEvent(normalize.EventEmission{
		SessionID: sessionID,
		Name:      "coding_agent.session.error",
		At:        time.Now(),
		Attrs:     attrs,
	})
}

// session.deleted destroys a persisted OpenCode conversation. It is not a
// signal that the agent completed successfully, so record the lifecycle event
// without fabricating a session-root outcome.
func handleSessionDeleted(_ context.Context, in normalize.Input, payload payloadEnvelope) error {
	var properties sessionCreatedProperties
	if err := json.Unmarshal(payload.Event.Properties, &properties); err != nil {
		return nil
	}
	sessionID := strings.TrimSpace(properties.Info.ID)
	if sessionID == "" {
		return nil
	}
	return in.Emit.EmitEvent(normalize.EventEmission{
		SessionID: sessionID,
		Name:      "coding_agent.session.deleted",
		At:        time.Now(),
		Attrs: map[string]any{
			semconv.CodingAgentClient:    in.Vendor,
			semconv.CodingAgentHookEvent: "session.deleted",
		},
	})
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
