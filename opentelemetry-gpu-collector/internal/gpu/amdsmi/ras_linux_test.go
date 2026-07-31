//go:build linux

package amdsmi

import "testing"

func TestParseTrailingInt(t *testing.T) {
	v, ok := parseTrailingInt("ue: 12")
	if !ok || v != 12 {
		t.Fatalf("got %v %v", v, ok)
	}
}

func TestReadRASEmpty(t *testing.T) {
	ce, ue := CollectRAS("/nonexistent/path")
	if ce != nil || ue != nil {
		t.Fatalf("expected nil, got %v %v", ce, ue)
	}
}
