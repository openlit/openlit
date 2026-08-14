package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// initRepo runs git init + initial commit in dir.
func initRepo(t *testing.T, dir string) {
	t.Helper()
	for _, args := range [][]string{
		{"init", "-q", "-b", "main"},
		{"config", "user.email", "test@example.com"},
		{"config", "user.name", "Test User"},
	} {
		c := exec.Command("git", args...)
		c.Dir = dir
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s: %v", args, out, err)
		}
	}
	// Add a file and commit.
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# test\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"add", "README.md"},
		{"commit", "-q", "-m", "init"},
	} {
		c := exec.Command("git", args...)
		c.Dir = dir
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s: %v", args, out, err)
		}
	}
}

func TestSnapshotInRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	initRepo(t, dir)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	got := Snapshot(ctx, dir)
	if got.HeadSHA == "" {
		t.Errorf("expected HeadSHA; got empty")
	}
	if got.Branch != "main" {
		t.Errorf("expected branch=main; got %q", got.Branch)
	}
	if got.Dirty {
		t.Errorf("expected clean worktree right after commit; got dirty=true")
	}

	// Make a working-tree change; expect Dirty=true.
	if err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	got2 := Snapshot(ctx, dir)
	if !got2.Dirty {
		t.Errorf("expected dirty after untracked file; got false")
	}
}

func TestSnapshotOutsideRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	got := Snapshot(ctx, dir)
	if !got.Empty() {
		t.Errorf("expected empty context outside repo; got %+v", got)
	}
}
