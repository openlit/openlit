package launch

import "testing"

func TestOpenCodeAgentMapping(t *testing.T) {
	t.Parallel()

	bin, err := agentBinary("opencode")
	if err != nil {
		t.Fatalf("agentBinary(opencode): %v", err)
	}
	if bin != "opencode" {
		t.Fatalf("agentBinary(opencode) = %q, want opencode", bin)
	}
	if vendor := vendorOf("opencode"); vendor != "opencode" {
		t.Fatalf("vendorOf(opencode) = %q, want opencode", vendor)
	}
}
