package agentexec

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openlit/openlit/cli/internal/config"
	"github.com/openlit/openlit/sdk/go/semconv"
)

const parent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"

func noEnv(string) string { return "" }

func build(t *testing.T, cfg *config.Resolved, traceparent string, capture bool) map[string]string {
	t.Helper()
	env, err := nativeEnv(semconv.CodingAgentVendorClaudeCode, cfg, traceparent, capture, noEnv)
	if err != nil {
		t.Fatalf("nativeEnv: %v", err)
	}
	return env
}

func TestNativeEnvSwitchesOnClaudeCodeTelemetry(t *testing.T) {
	t.Parallel()
	got := build(t, &config.Resolved{OTLPEndpoint: "https://collector.example"}, "", false)

	if got["CLAUDE_CODE_ENABLE_TELEMETRY"] != "1" {
		t.Fatal("telemetry not enabled")
	}
	if got["OTEL_EXPORTER_OTLP_ENDPOINT"] != "https://collector.example" {
		t.Fatalf("endpoint = %q", got["OTEL_EXPORTER_OTLP_ENDPOINT"])
	}
}

func TestNativeEnvKeepsVendorServiceName(t *testing.T) {
	t.Parallel()
	cfg := &config.Resolved{ApplicationName: "my app=1", Source: map[string]string{"application_name": "env"}}
	attrs := build(t, cfg, "", false)["OTEL_RESOURCE_ATTRIBUTES"]

	if strings.Contains(attrs, "service.name") {
		t.Fatalf("service.name must stay the vendor's: %q", attrs)
	}
	for _, want := range []string{"gen_ai.agent.name=claude-code", "openlit.caller.service=my%20app%3D1"} {
		if !strings.Contains(attrs, want) {
			t.Fatalf("%q missing from %q", want, attrs)
		}
	}
}

func TestNativeEnvOmitsTheDefaultApplicationName(t *testing.T) {
	t.Parallel()
	cfg := &config.Resolved{ApplicationName: "openlit-cli", Source: map[string]string{"application_name": "default"}}
	if attrs := build(t, cfg, "", false)["OTEL_RESOURCE_ATTRIBUTES"]; strings.Contains(attrs, "caller") {
		t.Fatalf("attrs = %q", attrs)
	}
}

func TestNativeEnvMergesInheritedResourceAttributes(t *testing.T) {
	t.Parallel()
	inherited := func(key string) string {
		if key == "OTEL_RESOURCE_ATTRIBUTES" {
			return "team=ml"
		}
		return ""
	}
	env, err := nativeEnv(semconv.CodingAgentVendorClaudeCode, &config.Resolved{}, "", false, inherited)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(env["OTEL_RESOURCE_ATTRIBUTES"], "team=ml,gen_ai.agent.name=") {
		t.Fatalf("attrs = %q", env["OTEL_RESOURCE_ATTRIBUTES"])
	}
}

func TestNativeEnvRespectsAnInheritedProtocol(t *testing.T) {
	t.Parallel()
	inherited := func(key string) string {
		if key == "OTEL_EXPORTER_OTLP_PROTOCOL" {
			return "grpc"
		}
		return ""
	}
	env, err := nativeEnv(semconv.CodingAgentVendorClaudeCode, &config.Resolved{}, "", false, inherited)
	if err != nil {
		t.Fatal(err)
	}
	if _, set := env["OTEL_EXPORTER_OTLP_PROTOCOL"]; set {
		t.Fatal("an inherited protocol must stand")
	}
}

func TestNativeEnvLinksToTheParent(t *testing.T) {
	t.Parallel()
	got := build(t, &config.Resolved{}, parent, false)

	if got["TRACEPARENT"] != parent {
		t.Fatalf("TRACEPARENT = %q", got["TRACEPARENT"])
	}
	if !strings.Contains(got["OTEL_RESOURCE_ATTRIBUTES"], "openlit.parent.trace_id=0af7651916cd43dd8448eb211c80319c") {
		t.Fatalf("attrs = %q", got["OTEL_RESOURCE_ATTRIBUTES"])
	}
}

func TestNativeEnvIgnoresAMalformedTraceparent(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"garbage", "00-x,service.name=evil-b7ad6b7169203331-01"} {
		got := build(t, &config.Resolved{}, value, false)
		if _, set := got["TRACEPARENT"]; set || strings.Contains(got["OTEL_RESOURCE_ATTRIBUTES"], "evil") {
			t.Fatalf("%q must not be forwarded: %v", value, got)
		}
	}
}

func TestNativeEnvSendsContentOnlyWhenAsked(t *testing.T) {
	t.Parallel()
	// `full` is the hook default. It must not reach this path, which has no redaction.
	cfg := &config.Resolved{CodingContentCapture: "full"}
	if _, set := build(t, cfg, "", false)["OTEL_LOG_USER_PROMPTS"]; set {
		t.Fatal("content must stay off without --capture-content")
	}
	if build(t, cfg, "", true)["OTEL_LOG_USER_PROMPTS"] != "1" {
		t.Fatal("--capture-content must turn content on")
	}
}

func TestNativeEnvEncodesHeaders(t *testing.T) {
	t.Parallel()
	cfg := &config.Resolved{APIKey: "key", OTLPHeaders: map[string]string{"x-a": "one,two=three"}}
	want := "Authorization=Bearer%20key,x-a=one%2Ctwo%3Dthree"
	if got := build(t, cfg, "", false)["OTEL_EXPORTER_OTLP_HEADERS"]; got != want {
		t.Fatalf("headers = %q, want %q", got, want)
	}
}

func TestNativeEnvRejectsOtherVendors(t *testing.T) {
	t.Parallel()
	if _, err := nativeEnv("cursor", &config.Resolved{}, "", false, noEnv); err == nil {
		t.Fatal("expected an error")
	}
}

func TestMergeEnvTakesOutWhatWouldUndoTheSetup(t *testing.T) {
	t.Parallel()
	got := mergeEnv([]string{"PATH=/bin", "OTEL_SERVICE_NAME=app", "OTEL_LOG_USER_PROMPTS=1"}, map[string]string{})
	if strings.Join(got, " ") != "PATH=/bin" {
		t.Fatalf("got %v", got)
	}
	got = mergeEnv([]string{"OTEL_LOG_USER_PROMPTS=0"}, map[string]string{"OTEL_LOG_USER_PROMPTS": "1"})
	if strings.Join(got, " ") != "OTEL_LOG_USER_PROMPTS=1" {
		t.Fatalf("got %v", got)
	}
}

func TestMergeEnvOverridesAndKeeps(t *testing.T) {
	t.Parallel()
	got := mergeEnv([]string{"PATH=/bin", "A=old"}, map[string]string{"A": "new", "B": "2"})
	want := []string{"PATH=/bin", "A=new", "B=2"}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func execCommand(t *testing.T, args ...string) (string, error) {
	t.Helper()
	t.Setenv("OPENLIT_OTLP_ENDPOINT", "")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:1")
	var out bytes.Buffer
	cmd := NewCmd()
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs(args)
	err := cmd.Execute()
	return out.String(), err
}

func TestExecPassesTheEnvironmentAndOutputThrough(t *testing.T) {
	out, err := execCommand(t, "--vendor=claude-code", "--", "sh", "-c", `echo "telemetry=$CLAUDE_CODE_ENABLE_TELEMETRY"`)
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if !strings.Contains(out, "telemetry=1") {
		t.Fatalf("output = %q", out)
	}
}

func TestExecPassesTheExitCodeThrough(t *testing.T) {
	_, err := execCommand(t, "--", "sh", "-c", "exit 7")
	var exit *ExitError
	if !errors.As(err, &exit) || exit.Code != 7 {
		t.Fatalf("err = %v, want exit code 7", err)
	}
}

func TestExecRefusesUnknownVendorBeforeRunning(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "ran")
	if _, err := execCommand(t, "--vendor=cursor", "--", "touch", marker); err == nil {
		t.Fatal("expected an error")
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("the agent must not run for an unsupported vendor")
	}
}

func TestExecStillRunsTheAgentWhenTelemetryIsUnreachable(t *testing.T) {
	out, err := execCommand(t, "--", "sh", "-c", "echo ran")
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if !strings.Contains(out, "ran") {
		t.Fatalf("output = %q", out)
	}
}

func TestExecUsesShellExitCodesWhenTheAgentCannotRun(t *testing.T) {
	_, err := execCommand(t, "--", "openlit-no-such-agent")
	var exit *ExitError
	if !errors.As(err, &exit) || exit.Code != exitNotFound {
		t.Fatalf("err = %v, want exit code %d", err, exitNotFound)
	}
}

func TestExecReportsASignalAs128PlusN(t *testing.T) {
	_, err := execCommand(t, "--", "sh", "-c", "kill -9 $$")
	var exit *ExitError
	if !errors.As(err, &exit) || exit.Code != 137 {
		t.Fatalf("err = %v, want exit code 137", err)
	}
}

func TestExecAcceptsAgentFlagsWithoutADoubleDash(t *testing.T) {
	out, err := execCommand(t, "sh", "-c", "echo ran")
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if !strings.Contains(out, "ran") {
		t.Fatalf("output = %q", out)
	}
}

func TestExecContentFlagReachesTheAgent(t *testing.T) {
	out, err := execCommand(t, "--capture-content", "--", "sh", "-c", `echo "prompts=$OTEL_LOG_USER_PROMPTS"`)
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if !strings.Contains(out, "prompts=1") {
		t.Fatalf("output = %q", out)
	}
}

func TestExecRequiresACommand(t *testing.T) {
	cmd := NewCmd()
	cmd.SetArgs(nil)
	cmd.SetOut(&bytes.Buffer{})
	cmd.SetErr(&bytes.Buffer{})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected an error")
	}
}
