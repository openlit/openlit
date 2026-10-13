package install

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/openlit/openlit/cli/internal/coding/opencodeconfig"
)

const openCodePluginTemplate = "marketplace/plugins/opencode/openlit.ts"

func installOpenCodePlugin(dryRun bool) ([]string, error) {
	openlitBin, err := resolveOpenlitBin()
	if err != nil {
		return nil, fmt.Errorf("locate openlit binary: %w (install openlit and ensure it is on PATH)", err)
	}
	target, err := opencodeconfig.PluginPath()
	if err != nil {
		return nil, err
	}
	return installOpenCodePluginAtPath(target, openlitBin, dryRun)
}

func installOpenCodePluginAt(home, openlitBin string, dryRun bool) ([]string, error) {
	return installOpenCodePluginAtConfig(home, "", openlitBin, dryRun)
}

func installOpenCodePluginAtConfig(home, xdgConfigHome, openlitBin string, dryRun bool) ([]string, error) {
	target := opencodeconfig.PluginPathAt(home, xdgConfigHome)
	return installOpenCodePluginAtPath(target, openlitBin, dryRun)
}

func installOpenCodePluginAtPath(target, openlitBin string, dryRun bool) ([]string, error) {
	body, err := marketplaceFS.ReadFile(openCodePluginTemplate)
	if err != nil {
		return nil, fmt.Errorf("read embedded opencode plugin: %w", err)
	}
	body = patchManifestBytes("openlit.ts", body, openlitBin)

	if dryRun {
		return []string{target}, nil
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(target, body, 0o644); err != nil {
		return nil, err
	}
	return []string{target}, nil
}
