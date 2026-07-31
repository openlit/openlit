package windxg

import "fmt"

// LUID is a Windows locally unique identifier for an adapter.
// Defined without OS tags so unit tests run on all platforms.
type LUID struct {
	LowPart  uint32
	HighPart int32
}

// FormatLUIDKey formats a LUID the way GPU PDH instance names encode it.
func FormatLUIDKey(l LUID) string {
	return fmt.Sprintf("0x%08X_0x%08X", uint32(l.HighPart), l.LowPart)
}
