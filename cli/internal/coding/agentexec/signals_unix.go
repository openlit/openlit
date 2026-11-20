//go:build !windows

package agentexec

import (
	"os"
	"os/exec"
	"syscall"
)

const signalExitBase = 128

var forwardedSignals = []os.Signal{syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP}

// shouldForward skips SIGINT at a terminal: Ctrl-C reaches the whole foreground
// process group, so the agent already has it and a second copy can mean "quit
// now" to an agent that handles the first one gracefully.
func shouldForward(received os.Signal) bool {
	if received != syscall.SIGINT {
		return true
	}
	info, err := os.Stdin.Stat()
	return err != nil || info.Mode()&os.ModeCharDevice == 0
}

// exitCode gives 128+N for a child killed by signal N, as a shell would.
// ExitCode() would report -1, which the process would turn into 255.
func exitCode(err *exec.ExitError) int {
	if status, ok := err.Sys().(syscall.WaitStatus); ok && status.Signaled() {
		return signalExitBase + int(status.Signal())
	}
	return err.ExitCode()
}
