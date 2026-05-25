// Package codex implements the Codex CLI hook adapter.
//
// Codex emits hooks (SessionStart, UserPromptSubmit, PostToolUse, Stop)
// with a JSON payload, plus a rollout JSONL at
// ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl that carries token usage
// the hooks alone don't expose.
//
// Full implementation lands with the cli-hook-codex todo.
package codex

import (
	"context"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/sdk/go/semconv"
)

// New returns a new Codex adapter.
func New() normalize.Adapter { return &adapter{} }

type adapter struct{}

func (a *adapter) Vendor() string { return semconv.CodingAgentVendorCodex }

func (a *adapter) Handle(ctx context.Context, in normalize.Input) error {
	return handle(ctx, in)
}
