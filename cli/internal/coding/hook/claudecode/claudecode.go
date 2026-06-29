// Package claudecode implements the Claude Code hook adapter.
//
// Claude Code invokes the hook by name (SessionStart, UserPromptSubmit,
// PreToolUse, PostToolUse, Stop, SubagentStop, SessionEnd) with a JSON
// payload on stdin. We additionally tail the per-session transcript
// file (`transcript_path` in the payload) for authoritative token
// usage and cost on SessionEnd, and for an early model attribution on
// SessionStart.
//
// Claude Code also exposes its own OTel exporter via
// `CLAUDE_CODE_ENABLE_TELEMETRY=1`. When the user has both paths on,
// the query layer dedupes per `session.id` (see
// `.cursor/rules/coding-agents-convention.mdc` §5). This adapter is
// responsible for the hook path only; it stamps
// `coding_agent.signal_source = "hook"` (via the resource attribute
// set in `cli/internal/otlp/exporter.go`) so the dual-path coalesce
// can tell them apart.
package claudecode

import (
	"context"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/sdk/go/semconv"
)

// New returns a new Claude Code adapter.
func New() normalize.Adapter { return &adapter{} }

type adapter struct{}

func (a *adapter) Vendor() string { return semconv.CodingAgentVendorClaudeCode }

func (a *adapter) Handle(ctx context.Context, in normalize.Input) error {
	return handle(ctx, in)
}
