package opencode

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/coding/sessionstate"
	"github.com/openlit/openlit/sdk/go/semconv"
)

func init() {
	eventHandlers["message.updated"] = handleMessageUpdated
}

type messageUpdatedProperties struct {
	Info messageInfo `json:"info"`
}

// messageInfo intentionally contains metadata fields only. OpenCode emits
// text and reasoning through message-part events; this adapter does not read
// those bodies, even when content capture is configured as full.
type messageInfo struct {
	ID         string `json:"id"`
	SessionID  string `json:"sessionID"`
	Role       string `json:"role"`
	Mode       string `json:"mode"`
	ModelID    string `json:"modelID"`
	ProviderID string `json:"providerID"`
	Model      struct {
		ModelID    string `json:"modelID"`
		ProviderID string `json:"providerID"`
	} `json:"model"`
	Time struct {
		Created   int64 `json:"created"`
		Completed int64 `json:"completed"`
	} `json:"time"`
	Cost   float64 `json:"cost"`
	Finish string  `json:"finish"`
	Tokens struct {
		Input     int64 `json:"input"`
		Output    int64 `json:"output"`
		Reasoning int64 `json:"reasoning"`
		Cache     struct {
			Read  int64 `json:"read"`
			Write int64 `json:"write"`
		} `json:"cache"`
	} `json:"tokens"`
}

func handleMessageUpdated(_ context.Context, in normalize.Input, payload payloadEnvelope) error {
	var properties messageUpdatedProperties
	if err := json.Unmarshal(payload.Event.Properties, &properties); err != nil {
		return nil
	}
	info := properties.Info
	sessionID := strings.TrimSpace(info.SessionID)
	if sessionID == "" {
		return nil
	}
	role := strings.ToLower(strings.TrimSpace(info.Role))
	if role != "assistant" || info.Time.Completed <= 0 {
		return nil
	}
	messageID := strings.TrimSpace(info.ID)
	if messageID == "" {
		return nil
	}

	model := firstNonEmpty(info.Model.ModelID, info.ModelID)
	provider := firstNonEmpty(info.Model.ProviderID, info.ProviderID)
	createdAt := timeFromUnixMillis(info.Time.Created)
	if createdAt.IsZero() {
		createdAt = time.Now()
	}
	endedAt := createdAt
	if completedAt := timeFromUnixMillis(info.Time.Completed); !completedAt.IsZero() {
		endedAt = completedAt
	}

	state := sessionstate.Load(sessionID, in.Vendor)
	if state == nil {
		state = &sessionstate.State{}
	}
	if state.ConversationID == "" {
		state.ConversationID = sessionID
	}
	if state.SessionStartedAt.IsZero() {
		state.SessionStartedAt = createdAt
	}
	if model != "" {
		state.Model = model
	}
	if mode := strings.TrimSpace(info.Mode); mode != "" {
		state.PermissionMode = mode
	}
	for _, emittedID := range state.EmittedAssistantTurnIDs {
		if emittedID == messageID {
			sessionstate.Save(sessionID, in.Vendor, state)
			return nil
		}
	}
	state.EmittedAssistantTurnIDs = append(state.EmittedAssistantTurnIDs, messageID)
	if len(state.EmittedAssistantTurnIDs) > 256 {
		state.EmittedAssistantTurnIDs = state.EmittedAssistantTurnIDs[len(state.EmittedAssistantTurnIDs)-256:]
	}

	extras := map[string]string{}
	if provider != "" {
		extras[semconv.GenAISystem] = provider
		extras[semconv.GenAIProviderName] = provider
	}
	turn := normalize.LLMTurn{
		SessionID:      sessionID,
		ConversationID: firstNonEmpty(state.ConversationID, sessionID),
		GenerationID:   messageID,
		Vendor:         in.Vendor,
		Model:          model,
		StartedAt:      createdAt,
		EndedAt:        endedAt,
		Extras:         extras,
	}
	turn.AssistantMessageOnly = true
	cacheRead := nonNegative(info.Tokens.Cache.Read)
	cacheWrite := nonNegative(info.Tokens.Cache.Write)
	reasoning := nonNegative(info.Tokens.Reasoning)
	turn.InputTokens = nonNegative(info.Tokens.Input)
	turn.OutputTokens = nonNegative(info.Tokens.Output)
	turn.ReasoningTokens = reasoning
	turn.TotalTokens = turn.InputTokens + turn.OutputTokens + reasoning + cacheRead + cacheWrite
	turn.CacheReadTokens = cacheRead
	turn.CacheCreationTokens = cacheWrite
	if info.Cost > 0 {
		turn.CostUSD = info.Cost
	}
	if finish := strings.TrimSpace(info.Finish); finish != "" {
		turn.FinishReasons = []string{finish}
	}
	if in.ContentCapture != semconv.CodingAgentContentCaptureMinimal {
		state.InputTokens += turn.InputTokens
		state.OutputTokens += turn.OutputTokens
		state.TotalTokens += turn.TotalTokens
		state.CostUSD += turn.CostUSD
		// This turn is emitted on its own span, so it is already represented
		// in downstream usage totals. Advance the snapshot watermarks by the
		// same increment; assigning the lifetime totals here would incorrectly
		// consume earlier minimal-mode usage that has not been flushed yet.
		state.OpenCodeSnapshotInputTokens += turn.InputTokens
		state.OpenCodeSnapshotOutputTokens += turn.OutputTokens
		state.OpenCodeSnapshotTotalTokens += turn.TotalTokens
		state.OpenCodeSnapshotCostUSD += turn.CostUSD
	}
	sessionstate.Save(sessionID, in.Vendor, state)
	return in.Emit.EmitLLMTurn(turn)
}

func timeFromUnixMillis(value int64) time.Time {
	if value <= 0 {
		return time.Time{}
	}
	return time.UnixMilli(value)
}

func nonNegative(value int64) int64 {
	if value < 0 {
		return 0
	}
	return value
}
