//go:build windows

package launch

import (
	"os"
	"os/exec"
)

// defaultExecReplace fakes exec(2) on Windows by spawning a child and
// exiting with its status. Stdio is wired straight through so it behaves
// like a real exec from the user's perspective.
func defaultExecReplace(path string, args []string) error {
	c := exec.Command(path, args[1:]...)
	c.Stdin = os.Stdin
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	if err := c.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		return err
	}
	os.Exit(0)
	return nil
}
