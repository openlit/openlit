// Package launch implements `openlit coding launch <agent>`.
//
// Behavior: ensure the per-vendor manifest is installed (auto-runs the
// install logic if it isn't), then exec the agent's own CLI with whatever
// args followed.
package launch

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
)

// NewCmd returns the `openlit coding launch` cobra command.
func NewCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "launch <agent> [-- agent-args...]",
		Short: "Bootstrap the openlit plugin for an agent and exec it",
		Long: `Bootstrap the openlit host plugin manifest for the chosen agent, then
exec the agent's own CLI.

Example:

  openlit coding launch claude
  openlit coding launch cursor -- --debug
  openlit coding launch codex

The agent's binary must be on PATH. The plugin manifest is installed
idempotently — running 'launch' twice is a no-op the second time.`,
		Args:          cobra.MinimumNArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return run(cmd, args)
		},
	}
	return cmd
}

func run(cmd *cobra.Command, args []string) error {
	agent := strings.ToLower(strings.TrimSpace(args[0]))
	if agent == "" {
		return errors.New("agent name is required")
	}

	bin, err := agentBinary(agent)
	if err != nil {
		return err
	}

	// Resolve the agent's binary first so we can fail fast if it's not
	// on PATH; no point installing a manifest for a missing CLI.
	resolved, lookErr := exec.LookPath(bin)
	if lookErr != nil {
		return fmt.Errorf("could not find %q on PATH: %w", bin, lookErr)
	}

	if err := ensureInstalled(cmd, agent); err != nil {
		// Don't block launch on manifest install failure — the agent
		// can still run, just without our hook. Print the error so the
		// user knows.
		fmt.Fprintf(cmd.ErrOrStderr(), "openlit launch: warning: install %s manifest failed: %v\n", agent, err)
	}

	// exec replaces the current process — this is intentional so the
	// user's terminal hooks back up to the agent's stdio without us in
	// the middle.
	rest := args[1:]
	// Strip an optional `--` separator inserted by cobra so it doesn't
	// reach the agent.
	if len(rest) > 0 && rest[0] == "--" {
		rest = rest[1:]
	}
	return execReplace(resolved, append([]string{bin}, rest...))
}

// agentBinary maps the user-friendly agent argument to the binary name
// we expect on PATH.
func agentBinary(agent string) (string, error) {
	switch agent {
	case "claude", "claude-code", "cc":
		return "claude", nil
	case "cursor":
		return "cursor", nil
	case "codex":
		return "codex", nil
	default:
		return "", fmt.Errorf("unknown agent %q (allowed: claude, cursor, codex)", agent)
	}
}

// ensureInstalled runs the install logic for one vendor. We don't import
// the install package directly to avoid a circular dependency potential;
// instead, we re-spawn ourselves with `coding install --vendor=...`.
// On the recommended install paths the binary is on PATH already.
func ensureInstalled(cmd *cobra.Command, agent string) error {
	vendor := vendorOf(agent)
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate self: %w", err)
	}
	c := exec.Command(exe, "coding", "install", "--vendor", vendor) //nolint:gosec // self-exec
	c.Stdout = cmd.OutOrStdout()
	c.Stderr = cmd.ErrOrStderr()
	return c.Run()
}

func vendorOf(agent string) string {
	switch agent {
	case "claude", "cc":
		return "claude-code"
	default:
		return agent
	}
}

// execReplace is the exec(2) syscall on POSIX; Windows fakes it via a
// child process + os.Exit. The cli/internal/coding/launch/exec_*.go
// files implement the platform-specific bits.
var execReplace = defaultExecReplace
