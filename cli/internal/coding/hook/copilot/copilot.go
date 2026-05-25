// Package copilot implements the GitHub Copilot CLI hook adapter.
//
// Copilot CLI exposes 10 hook events; payloads are JSON on stdin. The
// per-session events.jsonl at ~/.copilot/session-state/<id>/events.jsonl
// is tailed for token usage because the hook payloads alone don't carry
// reliable totals.
//
// Full implementation lands with the cli-hook-copilot todo.
package copilot

import (
	"context"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/sdk/go/semconv"
)

// New returns a new Copilot adapter.
func New() normalize.Adapter { return &adapter{} }

type adapter struct{}

func (a *adapter) Vendor() string { return semconv.CodingAgentVendorCopilot }

func (a *adapter) Handle(ctx context.Context, in normalize.Input) error {
	return handle(ctx, in)
}
