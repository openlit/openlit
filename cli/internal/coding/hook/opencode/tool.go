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
	eventHandlers["tool.execute.before"] = handleToolExecuteBefore
	eventHandlers["tool.execute.after"] = handleToolExecuteAfter
	eventHandlers["tool.execute.completed"] = handleToolExecuteCompleted
	eventHandlers["tool.execute.error"] = handleToolExecuteError
}

type toolProperties struct {
	Tool      string          `json:"tool"`
	SessionID string          `json:"sessionID"`
	CallID    string          `json:"callID"`
	Args      json.RawMessage `json:"args"`
	Output    json.RawMessage `json:"output"`
	Metadata  json.RawMessage `json:"metadata"`
	Status    string          `json:"status"`
	StartedAt int64           `json:"startedAt"`
	EndedAt   int64           `json:"endedAt"`
}

func handleToolExecuteBefore(_ context.Context, in normalize.Input, payload payloadEnvelope) error {
	properties, ok := decodeToolProperties(payload.Event.Properties)
	if !ok || !validToolIdentity(properties) {
		return nil
	}
	cwd := firstNonEmpty(payload.Directory, payload.Worktree)
	rememberToolContext(properties.SessionID, in.Vendor, cwd)
	at := timeFromUnixMillis(properties.StartedAt)
	if at.IsZero() {
		at = time.Now()
	}
	return in.Emit.EmitEvent(normalize.EventEmission{
		SessionID: properties.SessionID,
		Name:      "coding_agent.tool.requested",
		At:        at,
		Attrs: map[string]any{
			semconv.CodingAgentClient:    in.Vendor,
			semconv.CodingAgentHookEvent: "tool.execute.before",
			"gen_ai.tool.name":           properties.Tool,
			"gen_ai.tool.call.id":        properties.CallID,
			"code.cwd":                   cwd,
		},
	})
}

func handleToolExecuteAfter(_ context.Context, in normalize.Input, payload payloadEnvelope) error {
	properties, ok := decodeToolProperties(payload.Event.Properties)
	if !ok || !validToolIdentity(properties) {
		return nil
	}
	errored, errorMessage := toolError(properties.Metadata)
	return emitTerminalToolCall(in, payload, properties, errored, errorMessage, true)
}

func handleToolExecuteCompleted(_ context.Context, in normalize.Input, payload payloadEnvelope) error {
	properties, ok := decodeToolProperties(payload.Event.Properties)
	if !ok || !validToolIdentity(properties) || !strings.EqualFold(properties.Status, "completed") {
		return nil
	}
	// Provider-executed tools bypass OpenCode's explicit before/after hooks.
	// The plugin projects only safe terminal metadata from their ToolPart.
	return emitTerminalToolCall(in, payload, properties, false, "", false)
}

func handleToolExecuteError(_ context.Context, in normalize.Input, payload payloadEnvelope) error {
	properties, ok := decodeToolProperties(payload.Event.Properties)
	if !ok || !validToolIdentity(properties) || !strings.EqualFold(properties.Status, "error") {
		return nil
	}
	// This event is a safe projection of a body-bearing ToolPart. Never
	// read args, output, or the raw error string from it, even in full mode.
	return emitTerminalToolCall(in, payload, properties, true, "", false)
}

func emitTerminalToolCall(
	in normalize.Input,
	payload payloadEnvelope,
	properties toolProperties,
	errored bool,
	errorMessage string,
	allowBodies bool,
) error {
	cwd := firstNonEmpty(payload.Directory, payload.Worktree)
	if !claimToolCall(properties.SessionID, in.Vendor, properties.CallID, cwd, in.ContentCapture) {
		return nil
	}
	startedAt := timeFromUnixMillis(properties.StartedAt)
	endedAt := timeFromUnixMillis(properties.EndedAt)
	if startedAt.IsZero() {
		startedAt = time.Now()
	}
	if endedAt.IsZero() || endedAt.Before(startedAt) {
		endedAt = startedAt
	}
	call := normalize.ToolCall{
		SessionID:  properties.SessionID,
		ToolName:   properties.Tool,
		ToolUseID:  properties.CallID,
		Vendor:     in.Vendor,
		StartedAt:  startedAt,
		EndedAt:    endedAt,
		Duration:   endedAt.Sub(startedAt),
		Errored:    errored,
		WorkingDir: cwd,
	}
	if allowBodies {
		call.Command = commandFromArgs(properties.Tool, properties.Args, in.ContentCapture)
	}
	if errored {
		call.FailureType = "error"
	}
	if allowBodies && in.ContentCapture == semconv.CodingAgentContentCaptureFull {
		call.Args = rawJSON(properties.Args)
		call.Result = rawJSON(properties.Output)
		call.ErrorMsg = errorMessage
	}
	return in.Emit.EmitToolCall(call)
}

func validToolIdentity(properties toolProperties) bool {
	return properties.SessionID != "" && properties.Tool != "" && properties.CallID != ""
}

func decodeToolProperties(raw json.RawMessage) (toolProperties, bool) {
	var properties toolProperties
	if err := json.Unmarshal(raw, &properties); err != nil {
		return toolProperties{}, false
	}
	properties.Tool = strings.TrimSpace(properties.Tool)
	properties.SessionID = strings.TrimSpace(properties.SessionID)
	properties.CallID = strings.TrimSpace(properties.CallID)
	properties.Status = strings.TrimSpace(properties.Status)
	return properties, true
}

func claimToolCall(sessionID, vendor, callID, cwd, capture string) bool {
	state := sessionstate.Load(sessionID, vendor)
	for _, emittedID := range state.EmittedToolCallIDs {
		if emittedID == callID {
			return false
		}
	}
	state.EmittedToolCallIDs = append(state.EmittedToolCallIDs, callID)
	if len(state.EmittedToolCallIDs) > 256 {
		state.EmittedToolCallIDs = state.EmittedToolCallIDs[len(state.EmittedToolCallIDs)-256:]
	}
	if state.ConversationID == "" {
		state.ConversationID = sessionID
	}
	if state.SessionStartedAt.IsZero() {
		state.SessionStartedAt = time.Now()
	}
	if cwd != "" {
		state.CWD = cwd
	}
	if capture != semconv.CodingAgentContentCaptureMinimal {
		state.ToolCallCount++
	}
	sessionstate.Save(sessionID, vendor, state)
	return true
}

func rememberToolContext(sessionID, vendor, cwd string) {
	state := sessionstate.Load(sessionID, vendor)
	if state == nil {
		state = &sessionstate.State{}
	}
	if state.ConversationID == "" {
		state.ConversationID = sessionID
	}
	if state.SessionStartedAt.IsZero() {
		state.SessionStartedAt = time.Now()
	}
	if cwd != "" {
		state.CWD = cwd
	}
	sessionstate.Save(sessionID, vendor, state)
}

func rawJSON(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return value
	}
	return trimmed
}

func commandFromArgs(tool string, raw json.RawMessage, capture string) string {
	switch strings.ToLower(strings.TrimSpace(tool)) {
	case "bash", "shell", "sh", "zsh", "powershell", "pwsh":
	default:
		return ""
	}
	var args map[string]json.RawMessage
	if err := json.Unmarshal(raw, &args); err != nil {
		return ""
	}
	var command string
	for _, key := range []string{"command", "cmd", "shell"} {
		value, ok := args[key]
		if !ok {
			continue
		}
		if err := json.Unmarshal(value, &command); err == nil && strings.TrimSpace(command) != "" {
			break
		}
		var parts []string
		if err := json.Unmarshal(value, &parts); err == nil && len(parts) > 0 {
			command = strings.Join(parts, " ")
			break
		}
	}
	command = strings.TrimSpace(command)
	if command == "" || capture == semconv.CodingAgentContentCaptureFull {
		return command
	}
	fields := strings.Fields(command)
	if len(fields) == 0 || strings.Contains(fields[0], "=") {
		return ""
	}
	return fields[0]
}

func toolError(raw json.RawMessage) (bool, string) {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "null" {
		return false, ""
	}
	var metadata map[string]json.RawMessage
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return false, ""
	}
	if status := rawString(metadata["status"]); status != "" {
		switch strings.ToLower(status) {
		case "error", "failed", "failure":
			return true, rawErrorMessage(metadata["error"])
		}
	}
	for _, key := range []string{"exit", "exitCode", "exit_code"} {
		if value, ok := rawNumber(metadata[key]); ok && value != 0 {
			return true, rawErrorMessage(metadata["error"])
		}
	}
	if errorValue, ok := metadata["error"]; ok && hasJSONError(errorValue) {
		return true, rawErrorMessage(errorValue)
	}
	return false, ""
}

func rawString(raw json.RawMessage) string {
	var value string
	if len(raw) > 0 && json.Unmarshal(raw, &value) == nil {
		return strings.TrimSpace(value)
	}
	return ""
}

func rawNumber(raw json.RawMessage) (float64, bool) {
	var value float64
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return 0, false
	}
	return value, true
}

func hasJSONError(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" || trimmed == "false" || trimmed == `""` || trimmed == "{}" || trimmed == "[]" {
		return false
	}
	return true
}

func rawErrorMessage(raw json.RawMessage) string {
	if !hasJSONError(raw) {
		return ""
	}
	if value := rawString(raw); value != "" {
		return value
	}
	var object struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &object) == nil {
		return object.Message
	}
	return ""
}
