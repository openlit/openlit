package engine

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/openlit/openlit/openlit-controller/internal/config"
)

func writeFakeNodeProc(t *testing.T, procRoot string, pid int, packageJSON string) {
	t.Helper()
	pidDir := filepath.Join(procRoot, strconv.Itoa(pid))
	if err := os.MkdirAll(filepath.Join(pidDir, "root", "app"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/app", filepath.Join(pidDir, "cwd")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pidDir, "root", "app", "package.json"), []byte(packageJSON), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestDetectNodeAgentProvidersRequiresAgentFrameworkPackage(t *testing.T) {
	procRoot := t.TempDir()
	writeFakeNodeProc(t, procRoot, 1234, `{
		"dependencies": {
			"openai": "^6.0.0",
			"@ai-sdk/openai": "^2.0.0"
		}
	}`)

	if got := detectNodeAgentProviders(procRoot, 1234); len(got) != 0 {
		t.Fatalf("generic provider SDKs should not trigger passive discovery, got %v", got)
	}
}

func TestDetectNodeAgentProvidersFindsOpenAIAgents(t *testing.T) {
	procRoot := t.TempDir()
	writeFakeNodeProc(t, procRoot, 1234, `{
		"dependencies": {
			"@openai/agents": "0.12.0",
			"openai": "^6.42.0"
		}
	}`)

	got := detectNodeAgentProviders(procRoot, 1234)
	if len(got) != 1 || got[0] != "openai" {
		t.Fatalf("expected openai provider, got %v", got)
	}
}

func TestUpsertRuntimeDiscoveredService(t *testing.T) {
	eng := newTestEngine()
	eng.deployMode = config.DeployLinux
	meta := &ProcessMetadata{
		PID:         1234,
		ExePath:     "/usr/local/bin/node",
		Cmdline:     "node app.mjs",
		ServiceName: "agent-js",
		Runtime:     "nodejs",
	}

	eng.upsertRuntimeDiscoveredService(meta, []string{"openai"})
	services := eng.GetServices()
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	if services[0].LanguageRuntime != "nodejs" {
		t.Fatalf("expected nodejs runtime, got %q", services[0].LanguageRuntime)
	}
	if len(services[0].LLMProviders) != 1 || services[0].LLMProviders[0] != "openai" {
		t.Fatalf("expected openai provider, got %v", services[0].LLMProviders)
	}
}
