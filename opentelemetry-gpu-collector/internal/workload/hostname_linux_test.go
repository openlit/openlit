//go:build linux

package workload

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestReadHostnameFileRejectsFifoAndSymlink(t *testing.T) {
	dir := t.TempDir()
	fifo := filepath.Join(dir, "hostname-fifo")
	if err := unix.Mkfifo(fifo, 0o644); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	if got := readHostnameFile(fifo); got != "" {
		t.Fatalf("fifo read = %q", got)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("fifo open blocked for %s", elapsed)
	}

	real := filepath.Join(dir, "real")
	if err := os.WriteFile(real, []byte("gemma-worker-0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "hostname-link")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	if got := readHostnameFile(link); got != "" {
		t.Fatalf("symlink read = %q", got)
	}
}
