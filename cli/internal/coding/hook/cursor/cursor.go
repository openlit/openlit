// Package cursor implements the Cursor hook adapter.
//
// Cursor exposes 8 hook events; payloads are JSON on stdin. Cursor has
// no transcript file we can tail, so we rely entirely on the hooks +
// any LLM activity also flowing through OTel from the agent's own
// instrumentation (where available). Adapter logic lives in handle.go.
package cursor

import (
	"context"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/sdk/go/semconv"
)

// New returns a new Cursor adapter.
func New() normalize.Adapter { return &adapter{} }

type adapter struct{}

func (a *adapter) Vendor() string { return semconv.CodingAgentVendorCursor }

func (a *adapter) Handle(ctx context.Context, in normalize.Input) error {
	return handle(ctx, in)
}
