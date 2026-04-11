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
	otlpEndpoint string,
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
	buf.WriteString(fmt.Sprintf("Environment=\"OTEL_EXPORTER_OTLP_ENDPOINT=%s\"\n", escapeSystemdValue(otlpEndpoint)))
	buf.WriteString(fmt.Sprintf("Environment=\"OPENLIT_DISABLED_INSTRUMENTORS=%s\"\n", escapeSystemdValue(disabledInstrumentors)))
	return buf.String()
}

func escapeSystemdValue(value string) string {
	return strings.ReplaceAll(value, "\"", "\\\"")
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
