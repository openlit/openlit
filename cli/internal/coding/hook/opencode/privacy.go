package opencode

import (
	"context"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
)

func init() {
	eventHandlers["chat.message"] = ignoreBodyBearingMessageEvent
	eventHandlers["message.part.updated"] = ignoreBodyBearingMessageEvent
}

func ignoreBodyBearingMessageEvent(context.Context, normalize.Input, payloadEnvelope) error {
	return nil
}
