package procname

import (
	"os"
	"runtime"
	"testing"
)

func TestExecutableNameSelf(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("/proc only available on Linux")
	}
	pid := int32(os.Getpid())
	name := ExecutableName(pid)
	if name == "" {
		t.Fatal("expected non-empty executable name for self")
	}
}

func TestExecutableNameMissing(t *testing.T) {
	if got := ExecutableName(0); got != "" {
		t.Fatalf("pid 0: got %q", got)
	}
	if got := ExecutableName(-1); got != "" {
		t.Fatalf("negative pid: got %q", got)
	}
	_ = ExecutableName(1<<30 - 1)
}
