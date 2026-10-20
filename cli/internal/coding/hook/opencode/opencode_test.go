package opencode

import "testing"

func TestAdapterVendor(t *testing.T) {
	if got := New().Vendor(); got != "opencode" {
		t.Fatalf("Vendor() = %q, want %q", got, "opencode")
	}
}
