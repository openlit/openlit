package uninstall

import (
	"github.com/openlit/openlit/cli/internal/coding/opencodeconfig"
)

func uninstallOpenCodePlugin(dryRun bool) (removed []string, errs []string) {
	target, err := opencodeconfig.PluginPath()
	if err != nil {
		return nil, []string{err.Error()}
	}
	return uninstallOpenCodePluginAtPath(target, dryRun)
}

func uninstallOpenCodePluginAt(home string, dryRun bool) (removed []string, errs []string) {
	return uninstallOpenCodePluginAtConfig(home, "", dryRun)
}

func uninstallOpenCodePluginAtConfig(home, xdgConfigHome string, dryRun bool) (removed []string, errs []string) {
	target := opencodeconfig.PluginPathAt(home, xdgConfigHome)
	return uninstallOpenCodePluginAtPath(target, dryRun)
}

func uninstallOpenCodePluginAtPath(target string, dryRun bool) (removed []string, errs []string) {
	path, err := removePath(target, dryRun)
	if path != "" {
		removed = append(removed, path)
	}
	if err != nil {
		errs = append(errs, err.Error())
	}
	return removed, errs
}
