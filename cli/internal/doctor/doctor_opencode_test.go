package doctor

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectInstalledPluginsAtRecognizesOnlyOpenLitOpenCodePlugin(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	target := filepath.Join(home, ".config", "opencode", "plugins", "openlit.ts")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("mkdir plugin dir: %v", err)
	}
	if err := os.WriteFile(target, []byte("export const Unrelated = {}\n"), 0o644); err != nil {
		t.Fatalf("write unrelated plugin: %v", err)
	}
	if got := detectInstalledPluginsAt(home); hasInstalledVendor(got, "opencode") {
		t.Fatalf("unrelated openlit.ts was detected as the OpenLit plugin: %v", got)
	}

	body := []byte("Bun.spawn([openlitBin, \"coding\", \"hook\", \"--vendor=opencode\"])\n")
	if err := os.WriteFile(target, body, 0o644); err != nil {
		t.Fatalf("write OpenLit plugin: %v", err)
	}
	if got := detectInstalledPluginsAt(home); !hasInstalledVendor(got, "opencode") {
		t.Fatalf("OpenCode plugin not detected: %v", got)
	}
}

func TestDetectInstalledPluginsHonorsXDGConfigHome(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	xdgConfigHome := filepath.Join(t.TempDir(), "custom-config")
	target := filepath.Join(xdgConfigHome, "opencode", "plugins", "openlit.ts")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("mkdir plugin dir: %v", err)
	}
	body := []byte("Bun.spawn([openlitBin, \"coding\", \"hook\", \"--vendor=opencode\"])\n")
	if err := os.WriteFile(target, body, 0o644); err != nil {
		t.Fatalf("write OpenLit plugin: %v", err)
	}

	got := detectInstalledPluginsAtConfig(home, xdgConfigHome)
	if !hasInstalledVendor(got, "opencode") {
		t.Fatalf("XDG OpenCode plugin not detected: %v", got)
	}
}

func hasInstalledVendor(plugins []installedPlugin, vendor string) bool {
	for _, plugin := range plugins {
		if plugin.vendor == vendor {
			return true
		}
	}
	return false
}
