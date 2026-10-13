package install

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPatchManifestBytesQuotesOpenCodeBinaryForTypeScript(t *testing.T) {
	t.Parallel()

	body := []byte("const openlitBin = __OPENLIT_BIN_JSON__;\n")
	got := string(patchManifestBytes("openlit.ts", body, "C:\\Program Files\\OpenLIT\\openlit.exe"))

	if strings.Contains(got, "__OPENLIT_BIN_JSON__") {
		t.Fatalf("binary placeholder was not replaced: %s", got)
	}
	if !strings.Contains(got, "\"C:\\\\Program Files\\\\OpenLIT\\\\openlit.exe\"") {
		t.Fatalf("binary path is not a safe TypeScript string: %s", got)
	}
}

func TestInstallOpenCodePluginAtIsDryRunSafeAndIdempotent(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	bin := filepath.Join(home, "OpenLIT Bin", "openlit")
	target := filepath.Join(home, ".config", "opencode", "plugins", "openlit.ts")
	other := filepath.Join(home, ".config", "opencode", "plugins", "keep.ts")

	written, err := installOpenCodePluginAt(home, bin, true)
	if err != nil {
		t.Fatalf("dry-run: %v", err)
	}
	if len(written) != 1 || written[0] != target {
		t.Fatalf("dry-run paths = %v, want [%s]", written, target)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("dry-run created target: %v", err)
	}

	if err := os.MkdirAll(filepath.Dir(other), 0o755); err != nil {
		t.Fatalf("mkdir plugins: %v", err)
	}
	if err := os.WriteFile(other, []byte("user plugin"), 0o644); err != nil {
		t.Fatalf("write unrelated plugin: %v", err)
	}

	if _, err := installOpenCodePluginAt(home, bin, false); err != nil {
		t.Fatalf("first install: %v", err)
	}
	first, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read installed plugin: %v", err)
	}
	if strings.Contains(string(first), "__OPENLIT_BIN_JSON__") {
		t.Fatalf("installed plugin retained binary placeholder")
	}

	if _, err := installOpenCodePluginAt(home, bin, false); err != nil {
		t.Fatalf("second install: %v", err)
	}
	second, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read reinstalled plugin: %v", err)
	}
	if string(first) != string(second) {
		t.Fatalf("reinstall changed plugin content")
	}
	if got, err := os.ReadFile(other); err != nil || string(got) != "user plugin" {
		t.Fatalf("unrelated plugin changed: content=%q err=%v", got, err)
	}
}

func TestInstallOpenCodePluginHonorsXDGConfigHome(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	xdgConfigHome := filepath.Join(t.TempDir(), "custom-config")
	target := filepath.Join(xdgConfigHome, "opencode", "plugins", "openlit.ts")
	bin := filepath.Join(home, "bin", "openlit")

	written, err := installOpenCodePluginAtConfig(home, xdgConfigHome, bin, false)
	if err != nil {
		t.Fatalf("install with XDG_CONFIG_HOME: %v", err)
	}
	if len(written) != 1 || written[0] != target {
		t.Fatalf("written paths = %v, want [%s]", written, target)
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("XDG OpenCode plugin was not written: %v", err)
	}
	legacy := filepath.Join(home, ".config", "opencode", "plugins", "openlit.ts")
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatalf("legacy path was written despite XDG_CONFIG_HOME: %v", err)
	}
}

func TestOpenCodePluginTemplateUsesSafeTimedSpawn(t *testing.T) {
	t.Parallel()

	body, err := marketplaceFS.ReadFile(openCodePluginTemplate)
	if err != nil {
		t.Fatalf("read OpenCode plugin template: %v", err)
	}
	source := string(body)
	for _, want := range []string{
		`const openlitBin = __OPENLIT_BIN_JSON__`,
		"[openlitBin, \"coding\", \"hook\", \"--vendor=opencode\", `--event=${event.type}`]",
		`const payload = new Blob([JSON.stringify({ event, directory, worktree })])`,
		`stdin: payload`,
		`timeout: 5_000`,
		`windowsHide: true`,
	} {
		if !strings.Contains(source, want) {
			t.Errorf("OpenCode plugin missing %q", want)
		}
	}
	if strings.Contains(source, "\\${event.type}") {
		t.Error("OpenCode event interpolation is escaped and would send a literal placeholder")
	}
	if strings.Contains(source, "Bun.$") {
		t.Error("OpenCode plugin must not construct a shell command")
	}
}

func TestOpenCodePluginGuardsMissingToolHookOutput(t *testing.T) {
	t.Parallel()

	body, err := marketplaceFS.ReadFile(openCodePluginTemplate)
	if err != nil {
		t.Fatalf("read OpenCode plugin template: %v", err)
	}
	source := string(body)
	for _, want := range []string{
		`const projectedOutput = asRecord(output)`,
		`if (!projectedOutput)`,
		`args: projectedOutput?.args`,
		`title: projectedOutput.title`,
	} {
		if !strings.Contains(source, want) {
			t.Errorf("OpenCode plugin missing safe tool-output handling %q", want)
		}
	}
	for _, unsafe := range []string{
		`args: output.args`,
		`title: output.title`,
		`output: output.output`,
		`metadata: output.metadata`,
	} {
		if strings.Contains(source, unsafe) {
			t.Errorf("OpenCode plugin directly dereferences hook output: %q", unsafe)
		}
	}
}

func TestOpenCodePluginProjectsGenericEventsBeforeSpawning(t *testing.T) {
	t.Parallel()

	body, err := marketplaceFS.ReadFile(openCodePluginTemplate)
	if err != nil {
		t.Fatalf("read OpenCode plugin template: %v", err)
	}
	source := string(body)
	for _, want := range []string{
		`function projectEvent(event: OpenCodeEvent): OpenCodeEvent | undefined`,
		`"session.created"`,
		`"message.updated"`,
		`"session.idle"`,
		`"session.error"`,
		`"session.deleted"`,
		`"message.part.updated"`,
		`const isError = state?.status === "error"`,
		`metadata?.providerExecuted === true`,
		`type: isError ? "tool.execute.error" : "tool.execute.completed"`,
		`const projected = projectEvent(event)`,
		`if (!projected) return`,
	} {
		if !strings.Contains(source, want) {
			t.Errorf("OpenCode plugin missing safe event projection %q", want)
		}
	}
	for _, forbidden := range []string{
		`"chat.message"`,
		`...event`,
		`...info`,
		`...part`,
		`...state`,
	} {
		if strings.Contains(source, forbidden) {
			t.Errorf("OpenCode plugin must not forward unprojected content via %s", forbidden)
		}
	}
}

func TestOpenCodePluginQueuesTelemetryWithoutAwaitingItInHooks(t *testing.T) {
	t.Parallel()

	body, err := marketplaceFS.ReadFile(openCodePluginTemplate)
	if err != nil {
		t.Fatalf("read OpenCode plugin template: %v", err)
	}
	source := string(body)
	for _, want := range []string{
		`const maxQueuedEmissions = 32`,
		`queueMicrotask(() => {`,
		`if (queue.length >= maxQueuedEmissions)`,
		`const dropIndex = queue.findIndex((pending) => pending.priority < priority)`,
		`void enqueue(projected)`,
		`void enqueue({`,
	} {
		if !strings.Contains(source, want) {
			t.Errorf("OpenCode plugin missing non-blocking serial queue %q", want)
		}
	}
	for _, forbidden := range []string{
		`let pending = Promise.resolve()`,
		`await enqueue(`,
	} {
		if strings.Contains(source, forbidden) {
			t.Errorf("OpenCode hooks contain an unsafe queue pattern %q", forbidden)
		}
	}
}
