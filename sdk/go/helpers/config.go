package helpers

import "sync"

var (
	captureMessageContent     = true // default: capture content (matches Python SDK)
	captureMessageContentMu   sync.RWMutex
)

// SetCaptureMessageContent configures whether prompt/completion text is recorded
// in span attributes. Called by openlit.Init based on DisableCaptureMessageContent.
func SetCaptureMessageContent(capture bool) {
	captureMessageContentMu.Lock()
	captureMessageContent = capture
	captureMessageContentMu.Unlock()
}

// GetCaptureMessageContent returns whether message content should be captured.
func GetCaptureMessageContent() bool {
	captureMessageContentMu.RLock()
	defer captureMessageContentMu.RUnlock()
	return captureMessageContent
}
