package windxg

import "testing"

func TestFormatLUIDKey(t *testing.T) {
	got := FormatLUIDKey(LUID{LowPart: 0x5678, HighPart: 0})
	if got != "0x00000000_0x00005678" {
		t.Fatalf("got %q", got)
	}
}
