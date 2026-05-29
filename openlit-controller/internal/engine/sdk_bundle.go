package engine

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
)

const (
	pythonSDKPackagesDirName  = "packages"
	pythonSDKBootstrapDirName = "bootstrap"
)

// sdkVersionPattern allows only PEP 440-ish version strings: letters, digits,
// and the separators . _ + - (e.g. "1.34.0", "1.34.0rc1", "1.34.0+local").
// Crucially it forbids whitespace, quotes, ;, |, &, $, backticks, /, etc., so a
// version value can never break out of the `openlit==<version>` install command
// (including the shell-string variant used for the k8s/docker helper).
var sdkVersionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]*$`)

// isValidSDKVersion reports whether v is safe to interpolate into a pip install
// command. The empty string is valid (means "latest"). Validation is enforced
// at the action ingress (EnablePythonSDK); this is also called defensively here.
func isValidSDKVersion(v string) bool {
	if v == "" {
		return true
	}
	if len(v) > 64 {
		return false
	}
	return sdkVersionPattern.MatchString(v)
}

func pypiPackageSpec(version string) string {
	// Defense in depth: never emit an install spec for an unvalidated version.
	// Callers validate at ingress; if an invalid value somehow reaches here,
	// fall back to the unpinned package rather than build an injectable spec.
	if version == "" || !isValidSDKVersion(version) {
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
