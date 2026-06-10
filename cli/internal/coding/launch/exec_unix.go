//go:build !windows

package launch

import (
	"os"
	"syscall"
)

// defaultExecReplace replaces the current process with the agent's. On
// Unix this is a real exec(2): the user's TTY connects directly to the
// agent and our process is gone.
func defaultExecReplace(path string, args []string) error {
	return syscall.Exec(path, args, os.Environ()) //nolint:gosec // intentional self-replacing exec
}
