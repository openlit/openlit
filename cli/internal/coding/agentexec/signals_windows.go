//go:build windows

package agentexec

import (
	"os"
	"os/exec"
)

var forwardedSignals = []os.Signal{os.Interrupt}

func shouldForward(os.Signal) bool { return true }

func exitCode(err *exec.ExitError) int { return err.ExitCode() }
