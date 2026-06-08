package engine

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

var systemdDropInBaseDir = "/etc/systemd/system"

const (
	systemdSDKStateDir = "/var/lib/openlit/python-sdk"
	systemdDropInName  = "openlit-python-sdk.conf"
)

func linuxSystemdSDKSupported() bool {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return false
	}
	if err := os.MkdirAll(systemdDropInBaseDir, 0755); err != nil {
		return false
	}
	if err := os.MkdirAll(systemdSDKStateDir, 0755); err != nil {
		return false
	}
	return true
}

func systemdDropInPath(unit string) string {
	return filepath.Join(systemdDropInBaseDir, unit+".d", systemdDropInName)
}

func writeSystemdDropIn(unit string, content string) error {
	dropInPath := systemdDropInPath(unit)
	if err := os.MkdirAll(filepath.Dir(dropInPath), 0755); err != nil {
		return fmt.Errorf("create systemd drop-in dir: %w", err)
	}
	if err := os.WriteFile(dropInPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("write systemd drop-in: %w", err)
	}
	return nil
}

func removeSystemdDropIn(unit string) error {
	dropInPath := systemdDropInPath(unit)
	if err := os.Remove(dropInPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove systemd drop-in: %w", err)
	}
	return nil
}

func runSystemctl(args ...string) error {
	cmd := exec.Command("systemctl", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s failed: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

func buildSystemdDropInContent(
	unit string,
	sdkRoot string,
	serviceName string,
	workloadKey string,
	payload systemdOTLPPayload,
	disabledInstrumentors string,
	existingPythonPath string,
	configHash string,
) string {
	var buf bytes.Buffer
	pythonPath := fmt.Sprintf("%s/%s:%s/%s", sdkRoot, pythonSDKBootstrapDirName, sdkRoot, pythonSDKPackagesDirName)
	if existingPythonPath != "" {
		pythonPath += ":" + existingPythonPath
	}
	buf.WriteString("[Service]\n")
	buf.WriteString(fmt.Sprintf("# openlit-managed-unit=%s\n", unit))
	buf.WriteString(fmt.Sprintf("# openlit-managed-config-hash=%s\n", configHash))
	buf.WriteString(fmt.Sprintf("Environment=\"PYTHONPATH=%s\"\n", escapeSystemdValue(pythonPath)))
	buf.WriteString("Environment=\"OPENLIT_CONTROLLER_MODE=agent_observability\"\n")
	buf.WriteString(fmt.Sprintf("Environment=\"OTEL_SERVICE_NAME=%s\"\n", escapeSystemdValue(serviceName)))
	if workloadKey != "" {
		buf.WriteString(fmt.Sprintf(
			"Environment=\"OTEL_RESOURCE_ATTRIBUTES=service.workload.key=%s\"\n",
			escapeSystemdValue(workloadKey),
		))
	}
	buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_ENDPOINT=%s\"\n", escapeSystemdValue(payload.OTLPEndpoint)))
	buf.WriteString(fmt.Sprintf("Environment=\"OTEL_DEPLOYMENT_ENVIRONMENT=%s\"\n", escapeSystemdValue(payload.Environment)))
	if payload.OTLPProtocol != "" {
		buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_PROTOCOL=%s\"\n", escapeSystemdValue(payload.OTLPProtocol)))
	}
	if payload.OTLPTracesEndpoint != "" {
		buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=%s\"\n", escapeSystemdValue(payload.OTLPTracesEndpoint)))
	}
	if payload.OTLPMetricsEndpoint != "" {
		buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=%s\"\n", escapeSystemdValue(payload.OTLPMetricsEndpoint)))
	}
	if payload.OTLPLogsEndpoint != "" {
		buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=%s\"\n", escapeSystemdValue(payload.OTLPLogsEndpoint)))
	}
	if payload.OTLPHeaders != "" {
		buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_HEADERS=%s\"\n", escapeSystemdValue(payload.OTLPHeaders)))
	}
	buf.WriteString(fmt.Sprintf("Environment=\"OPENLIT_DISABLED_INSTRUMENTORS=%s\"\n", escapeSystemdValue(disabledInstrumentors)))
	return buf.String()
}

type systemdOTLPPayload struct {
	OTLPEndpoint        string
	OTLPProtocol        string
	OTLPTracesEndpoint  string
	OTLPMetricsEndpoint string
	OTLPLogsEndpoint    string
	OTLPHeaders         string
	Environment         string
}

// escapeSystemdValue makes a string safe to embed inside a double-quoted
// systemd Environment="KEY=<value>" directive. Inputs can be attacker-influenced
// (e.g. a user-set OTEL_SERVICE_NAME adopted as service name, or poll-supplied
// OTLP settings), so we must prevent breaking out of the quoted value into new
// unit directives. Order matters: escape backslashes first, then quotes, then
// drop all C0 control characters (0x00–0x1F): CR/LF would terminate the directive
// and inject a new one; tabs and other controls are invalid in a single-line value.
func escapeSystemdValue(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\"", "\\\"")
	value = strings.Map(func(r rune) rune {
		// Drop every C0 control (including tab); none are valid here.
		if r == '\n' || r == '\r' || (r >= 0 && r < 0x20) {
			return -1
		}
		return r
	}, value)
	return value
}

func readSystemdDropInConfigHash(unit string) string {
	data, err := os.ReadFile(systemdDropInPath(unit))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "# openlit-managed-config-hash=") {
			return strings.TrimSpace(strings.TrimPrefix(line, "# openlit-managed-config-hash="))
		}
	}
	return ""
}
