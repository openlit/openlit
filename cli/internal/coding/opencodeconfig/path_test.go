package opencodeconfig

import (
	"path/filepath"
	"testing"
)

func TestPluginPathUsesTrimmedXDGWithoutHomeDirectory(t *testing.T) {
	xdgConfigHome := filepath.Join(t.TempDir(), "xdg")
	t.Setenv("XDG_CONFIG_HOME", "  "+xdgConfigHome+"  ")
	t.Setenv("HOME", "")
	t.Setenv("USERPROFILE", "")

	got, err := PluginPath()
	if err != nil {
		t.Fatalf("PluginPath() with XDG_CONFIG_HOME set: %v", err)
	}

	want := filepath.Join(xdgConfigHome, "opencode", "plugins", "openlit.ts")
	if got != want {
		t.Fatalf("PluginPath() = %q, want %q", got, want)
	}
}

func TestPluginPathAtTrimsXDGConfigHome(t *testing.T) {
	got := PluginPathAt("unused-home", "  /custom/config  ")
	want := filepath.Join("/custom/config", "opencode", "plugins", "openlit.ts")
	if got != want {
		t.Fatalf("PluginPathAt() = %q, want %q", got, want)
	}
}

func TestPluginPathAtWhitespaceXDGFallsBackToUserHome(t *testing.T) {
	home := `C:\Users\openlit`
	got := PluginPathAt(home, " \t ")
	want := filepath.Join(home, ".config", "opencode", "plugins", "openlit.ts")
	if got != want {
		t.Fatalf("PluginPathAt() = %q, want %q", got, want)
	}
}
