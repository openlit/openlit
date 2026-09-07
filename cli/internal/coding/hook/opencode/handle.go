package opencode

import (
	"context"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
)

func handle(ctx context.Context, in normalize.Input) error { return handlePayload(ctx, in) }
