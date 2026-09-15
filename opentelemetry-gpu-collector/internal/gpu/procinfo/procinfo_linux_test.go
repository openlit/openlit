//go:build linux

package procinfo

import (
	"os"
	"testing"
)

func TestFormatCmdline(t *testing.T) {
	in := []byte("python\x00-m\x00vllm.entrypoints.openai.api_server\x00")
	got := formatCmdline(in)
	want := "python -m vllm.entrypoints.openai.api_server"
	if got != want {
		t.Fatalf("formatCmdline = %q, want %q", got, want)
	}
}

func TestMapLinuxState(t *testing.T) {
	cases := map[string]string{
		"R (running)":  "running",
		"S (sleeping)": "sleeping",
		"Z (zombie)":   "zombie",
		"T (stopped)":  "stopped",
		"X (dead)":     "dead",
		"":             "unknown",
	}
	for in, want := range cases {
		if got := mapLinuxState(in); got != want {
			t.Errorf("mapLinuxState(%q)=%q want %q", in, got, want)
		}
	}
}

func TestLookupSelf(t *testing.T) {
	pid := int32(os.Getpid())
	info := Lookup(pid)
	if info.State == "unknown" && info.CommandLine == "" {
		t.Fatalf("Lookup(self) returned empty: %+v", info)
	}
	if info.State == "zombie" {
		t.Fatalf("self should not be zombie: %+v", info)
	}
}

func TestLookupInvalid(t *testing.T) {
	info := Lookup(0)
	if info.State != "unknown" {
		t.Fatalf("state=%q", info.State)
	}
}
