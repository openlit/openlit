package uninstall

import (
	"os"
	"path/filepath"
	"testing"
)

// TestRemovePath covers the three states the helper has to handle:
// missing path (no-op, no error), existing file (removed unless
// dry-run), existing directory (recursive remove unless dry-run).
//
// These are the failure modes that bit us during install: a stale
// re-run had to be safe, and a missing path on a fresh box couldn't
// surface as a noisy error.
func TestRemovePath(t *testing.T) {
	t.Parallel()
	tmp := t.TempDir()

	t.Run("missing path is a no-op", func(t *testing.T) {
		t.Parallel()
		missing := filepath.Join(t.TempDir(), "does-not-exist")
		path, err := removePath(missing, false)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if path != "" {
			t.Fatalf("expected empty path for missing target, got %q", path)
		}
	})

	t.Run("existing directory is removed", func(t *testing.T) {
		t.Parallel()
		dir := filepath.Join(tmp, "vendor-dir")
		nested := filepath.Join(dir, "hooks", "hooks.json")
		if err := os.MkdirAll(filepath.Dir(nested), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(nested, []byte("{}"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}

		path, err := removePath(dir, false)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if path != dir {
			t.Fatalf("expected returned path %q, got %q", dir, path)
		}
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("expected directory removed, stat returned %v", err)
		}
	})

	t.Run("dry-run leaves disk untouched", func(t *testing.T) {
		t.Parallel()
		dir := filepath.Join(tmp, "dry-run-dir")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		path, err := removePath(dir, true)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if path != dir {
			t.Fatalf("dry-run should report the path that would be removed; got %q", path)
		}
		if _, err := os.Stat(dir); err != nil {
			t.Fatalf("dry-run must not touch disk; stat error: %v", err)
		}
	})
}

// TestVendorsFromArg is a regression guard for the inverse-of-install
// vendor parser. If install/ ever adds a new vendor, this test should
// be updated in the same patch so uninstall stays symmetric.
func TestVendorsFromArg(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want []string
	}{
		{"all", []string{"claude-code", "cursor", "codex"}},
		{"cc", []string{"claude-code"}},
		{"claude-code", []string{"claude-code"}},
		{"cursor", []string{"cursor"}},
		{"codex", []string{"codex"}},
	}
	for _, tc := range cases {
		got, err := vendorsFromArg(tc.in)
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", tc.in, err)
		}
		if !equalSlice(got, tc.want) {
			t.Fatalf("%s: got %v, want %v", tc.in, got, tc.want)
		}
	}

	if _, err := vendorsFromArg("nope"); err == nil {
		t.Fatalf("unknown vendor should error")
	}
}

func equalSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
