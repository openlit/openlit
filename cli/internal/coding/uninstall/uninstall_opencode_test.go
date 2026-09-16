package uninstall

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUninstallOpenCodePluginAtRemovesOnlyOpenLitFile(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	plugins := filepath.Join(home, ".config", "opencode", "plugins")
	target := filepath.Join(plugins, "openlit.ts")
	other := filepath.Join(plugins, "keep.ts")
	if err := os.MkdirAll(plugins, 0o755); err != nil {
		t.Fatalf("mkdir plugins: %v", err)
	}
	if err := os.WriteFile(target, []byte("openlit"), 0o644); err != nil {
		t.Fatalf("write openlit plugin: %v", err)
	}
	if err := os.WriteFile(other, []byte("user plugin"), 0o644); err != nil {
		t.Fatalf("write unrelated plugin: %v", err)
	}

	removed, errs := uninstallOpenCodePluginAt(home, true)
	if len(errs) != 0 {
		t.Fatalf("dry-run errors: %v", errs)
	}
	if len(removed) != 1 || removed[0] != target {
		t.Fatalf("dry-run paths = %v, want [%s]", removed, target)
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("dry-run removed target: %v", err)
	}

	removed, errs = uninstallOpenCodePluginAt(home, false)
	if len(errs) != 0 {
		t.Fatalf("uninstall errors: %v", errs)
	}
	if len(removed) != 1 || removed[0] != target {
		t.Fatalf("removed paths = %v, want [%s]", removed, target)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("OpenLit plugin still exists: %v", err)
	}
	if got, err := os.ReadFile(other); err != nil || string(got) != "user plugin" {
		t.Fatalf("unrelated plugin changed: content=%q err=%v", got, err)
	}
}

func TestUninstallOpenCodePluginHonorsXDGConfigHome(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	xdgConfigHome := filepath.Join(t.TempDir(), "custom-config")
	target := filepath.Join(xdgConfigHome, "opencode", "plugins", "openlit.ts")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("mkdir plugin dir: %v", err)
	}
	if err := os.WriteFile(target, []byte("openlit"), 0o644); err != nil {
		t.Fatalf("write plugin: %v", err)
	}

	removed, errs := uninstallOpenCodePluginAtConfig(home, xdgConfigHome, false)
	if len(errs) != 0 {
		t.Fatalf("uninstall errors: %v", errs)
	}
	if len(removed) != 1 || removed[0] != target {
		t.Fatalf("removed paths = %v, want [%s]", removed, target)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("XDG OpenCode plugin still exists: %v", err)
	}
}
