package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildSystemdDropInContent(t *testing.T) {
	content := buildSystemdDropInContent(
		"myapp.service",
		"/var/lib/openlit/python-sdk/myapp",
		"myapp",
		"linux:systemd:myapp.service",
		systemdOTLPPayload{
			OTLPEndpoint: "http://otel:4318",
			Environment:  "production",
		},
		"openai,anthropic",
		"/usr/lib/python3",
		"abc123",
	)

	if !strings.Contains(content, "[Service]") {
		t.Error("expected [Service] section header")
	}
	if !strings.Contains(content, "PYTHONPATH=") {
		t.Error("expected PYTHONPATH env")
	}
	if !strings.Contains(content, "/usr/lib/python3") {
		t.Error("expected existing PYTHONPATH to be preserved")
	}
	if !strings.Contains(content, "OTEL_SERVICE_NAME=myapp") {
		t.Error("expected OTEL_SERVICE_NAME")
	}
	if !strings.Contains(content, "OTEL_RESOURCE_ATTRIBUTES=service.workload.key=linux:systemd:myapp.service") {
		t.Error("expected OTEL_RESOURCE_ATTRIBUTES with service.workload.key")
	}
	if !strings.Contains(content, "OTEL_EXPORTER_OTLP_ENDPOINT=http://otel:4318") {
		t.Error("expected OTEL_EXPORTER_OTLP_ENDPOINT")
	}
	if !strings.Contains(content, "OTEL_DEPLOYMENT_ENVIRONMENT=production") {
		t.Error("expected OTEL_DEPLOYMENT_ENVIRONMENT")
	}
	if !strings.Contains(content, "openlit-managed-config-hash=abc123") {
		t.Error("expected config hash comment")
	}
	if !strings.Contains(content, "OPENLIT_DISABLED_INSTRUMENTORS=openai,anthropic") {
		t.Error("expected disabled instrumentors")
	}
}

func TestBuildSystemdDropInContentNoPreviousPythonPath(t *testing.T) {
	content := buildSystemdDropInContent(
		"myapp.service",
		"/var/lib/openlit/python-sdk/myapp",
		"myapp",
		"",
		systemdOTLPPayload{
			OTLPEndpoint: "http://otel:4318",
			Environment:  "default",
		},
		"openai",
		"",
		"hash1",
	)

	lines := strings.Split(content, "\n")
	for _, line := range lines {
		if strings.Contains(line, "PYTHONPATH=") && strings.HasSuffix(strings.TrimSpace(line), ":\"") {
			t.Error("PYTHONPATH should not end with colon when no existing path")
		}
	}
	if strings.Contains(content, "OTEL_RESOURCE_ATTRIBUTES") {
		t.Error("OTEL_RESOURCE_ATTRIBUTES should be omitted when workloadKey is empty")
	}
}

func TestWriteAndRemoveSystemdDropIn(t *testing.T) {
	origBase := systemdDropInBaseDir
	systemdDropInBaseDir = t.TempDir()
	defer func() { systemdDropInBaseDir = origBase }()

	unit := "test.service"
	content := "[Service]\nEnvironment=\"FOO=bar\"\n"

	if err := writeSystemdDropIn(unit, content); err != nil {
		t.Fatalf("writeSystemdDropIn: %v", err)
	}

	dropInPath := filepath.Join(systemdDropInBaseDir, unit+".d", systemdDropInName)
	data, err := os.ReadFile(dropInPath)
	if err != nil {
		t.Fatalf("read drop-in: %v", err)
	}
	if string(data) != content {
		t.Errorf("content mismatch: got %q, want %q", string(data), content)
	}

	if err := removeSystemdDropIn(unit); err != nil {
		t.Fatalf("removeSystemdDropIn: %v", err)
	}
	if _, err := os.Stat(dropInPath); !os.IsNotExist(err) {
		t.Error("expected drop-in to be removed")
	}
}

func TestRemoveSystemdDropInNonExistent(t *testing.T) {
	origBase := systemdDropInBaseDir
	systemdDropInBaseDir = t.TempDir()
	defer func() { systemdDropInBaseDir = origBase }()

	if err := removeSystemdDropIn("nonexistent.service"); err != nil {
		t.Fatalf("removing non-existent should not error, got: %v", err)
	}
}

func TestReadSystemdDropInConfigHash(t *testing.T) {
	origBase := systemdDropInBaseDir
	systemdDropInBaseDir = t.TempDir()
	defer func() { systemdDropInBaseDir = origBase }()

	unit := "hashtest.service"
	content := "[Service]\n# openlit-managed-config-hash=myhash123\nEnvironment=\"FOO=bar\"\n"
	if err := writeSystemdDropIn(unit, content); err != nil {
		t.Fatal(err)
	}

	got := readSystemdDropInConfigHash(unit)
	if got != "myhash123" {
		t.Errorf("expected myhash123, got %q", got)
	}
}

func TestEscapeSystemdValue(t *testing.T) {
	cases := []struct{ in, want string }{
		{`value with "quotes"`, `value with \"quotes\"`},
		{`back\slash`, `back\\slash`},
		// Newline injection must be neutralized — otherwise a crafted value could
		// inject a new Environment=/[Service] directive into the unit drop-in.
		{"a\nEnvironment=\"EVIL=1\"", `aEnvironment=\"EVIL=1\"`},
		{"a\r\nb", "ab"},
		{"tab\tafter", "tabafter"},
	}
	for _, c := range cases {
		if got := escapeSystemdValue(c.in); got != c.want {
			t.Errorf("escapeSystemdValue(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	// Critical invariant: output never contains a raw line break.
	for _, in := range []string{"x\ny", "x\r\ny", "a\nb\nc"} {
		for _, r := range escapeSystemdValue(in) {
			if r == '\n' || r == '\r' {
				t.Fatalf("escapeSystemdValue(%q) left a line break", in)
			}
		}
	}
}
