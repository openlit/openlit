package engine

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const (
	pythonSDKPackagesDirName  = "packages"
	pythonSDKBootstrapDirName = "bootstrap"
)

func pypiPackageSpec(version string) string {
	if version == "" {
		return "openlit"
	}
	return "openlit==" + version
}

func buildPyPIInstallShellCmd(targetRoot, version string) string {
	pkg := pypiPackageSpec(version)
	packagesDir := targetRoot + "/" + pythonSDKPackagesDirName
	bootstrapDir := targetRoot + "/" + pythonSDKBootstrapDirName
	return fmt.Sprintf(
		`set -e; python -m pip install --no-cache-dir --target %s %s && `+
			`mkdir -p %s && `+
			`cp %s/openlit/cli/bootstrap/sitecustomize.py %s/sitecustomize.py && `+
			`python -c "import pathlib; dist=list(pathlib.Path('%s').glob('openlit-*.dist-info/METADATA')); ver='unknown'; [exec('for line in d.read_text().splitlines():\n if line.startswith(\"Version:\"):\n  ver=line.split(\":\",1)[1].strip(); break') for d in dist]; open('%s/.openlit-version','w').write(ver)"`,
		packagesDir, pkg,
		bootstrapDir,
		packagesDir, bootstrapDir,
		packagesDir, targetRoot,
	)
}

func installPythonSDKFromPyPI(pythonBinaryPath, targetRoot, version string) error {
	if err := os.MkdirAll(targetRoot, 0755); err != nil {
		return fmt.Errorf("create sdk target dir: %w", err)
	}

	packagesDir := filepath.Join(targetRoot, pythonSDKPackagesDirName)
	bootstrapDir := filepath.Join(targetRoot, pythonSDKBootstrapDirName)
	if err := os.MkdirAll(packagesDir, 0755); err != nil {
		return fmt.Errorf("create packages dir: %w", err)
	}
	if err := os.MkdirAll(bootstrapDir, 0755); err != nil {
		return fmt.Errorf("create bootstrap dir: %w", err)
	}

	pkg := pypiPackageSpec(version)
	installCmd := exec.Command(pythonBinaryPath, "-m", "pip", "install", "--no-cache-dir", "--target", packagesDir, pkg)
	installCmd.Env = os.Environ()
	output, err := installCmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("pip install openlit: %w: %s", err, string(output))
	}

	src := filepath.Join(packagesDir, "openlit", "cli", "bootstrap", "sitecustomize.py")
	dst := filepath.Join(bootstrapDir, "sitecustomize.py")
	data, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("read sitecustomize.py from installed SDK: %w", err)
	}
	if err := os.WriteFile(dst, data, 0644); err != nil {
		return fmt.Errorf("write sitecustomize.py to bootstrap dir: %w", err)
	}

	return nil
}
