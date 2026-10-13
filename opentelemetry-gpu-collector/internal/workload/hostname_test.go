package workload

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHostnameMatchesPod(t *testing.T) {
	cases := []struct {
		hostname, pod string
		want          bool
	}{
		{"gemma-worker-0", "gemma-worker-0", true},
		{"gemma-worker-0.gemma.llms.svc.cluster.local", "gemma-worker-0", true}, // setHostnameAsFQDN
		{"gemma-worker-01", "gemma-worker-0", false},
		{"gemma-worker-0", "gemma-worker-01", false},
		{"gpu-node-7", "gemma-worker-0", false}, // hostNetwork pod / host process
		{"", "gemma-worker-0", false},
		{"gemma-worker-0", "", false},
	}
	for _, c := range cases {
		if got := hostnameMatchesPod(c.hostname, c.pod); got != c.want {
			t.Errorf("hostnameMatchesPod(%q, %q) = %v, want %v", c.hostname, c.pod, got, c.want)
		}
	}
}

func TestReadHostnameFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "hostname")
	if err := os.WriteFile(p, []byte("  gemma-worker-0\n# ignored second line\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := readHostnameFile(p); got != "gemma-worker-0" {
		t.Fatalf("readHostnameFile = %q", got)
	}
	if got := readHostnameFile(filepath.Join(dir, "missing")); got != "" {
		t.Fatalf("missing file should be empty, got %q", got)
	}
	if got := ProcHostname(0); got != "" {
		t.Fatalf("pid 0 should be empty, got %q", got)
	}
}
