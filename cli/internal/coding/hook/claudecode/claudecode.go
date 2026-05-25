// Package claudecode implements the Claude Code hook adapter.
//
// Claude Code invokes the hook by name (SessionStart, PreToolUse, etc.)
// with a JSON payload on stdin. We additionally tail the per-session
// transcript file for full token usage on Stop.
//
// Full implementation lands with the cli-hook-cc todo.
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
