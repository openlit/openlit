// Package agentexec implements `openlit coding exec`, which runs a headless
// coding agent with its native telemetry switched on, inside a span.
//
// `launch` is for interactive use: it replaces this process with the agent, so
// nothing is left to end a span. `exec` stays as the parent instead. It exists
// for modes where hooks cannot run, such as `claude -p` with settings disabled.
//
// The agent matters more than its telemetry. Any telemetry failure is reported
// on stderr and the agent runs regardless, with its exit code passed through.
package agentexec

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/openlit/openlit/cli/internal/config"
	"github.com/openlit/openlit/cli/internal/otlp"
	"github.com/openlit/openlit/sdk/go/semconv"
	"github.com/spf13/cobra"
)

const (
	flushBudget = 2 * time.Second

	// Shell conventions for a command that could not be run.
	exitNotExecutable = 126
	exitNotFound      = 127
)

// ExitError carries the agent's exit code back to main.
type ExitError struct{ Code int }

func (e *ExitError) Error() string { return fmt.Sprintf("agent exited with code %d", e.Code) }

// NewCmd returns the `openlit coding exec` cobra command.
func NewCmd() *cobra.Command {
	var vendor string
	var captureContent bool
	cmd := &cobra.Command{
		Use:   "exec --vendor=<vendor> [--capture-content] -- <command> [args...]",
		Short: "Run a headless coding agent with its native telemetry on",
		Long: `Run a coding agent with its own OTel telemetry switched on, inside a span.

Use this where hooks and plugins are off, for example CI jobs or restricted
modes. For interactive sessions use 'openlit coding launch'.

A TRACEPARENT in the environment makes the span a child of the caller's trace.
The agent's exit code is passed through. A signal that kills it gives 128+N.

Prompts and tool details stay off unless you pass --capture-content. The agent
exports them directly, so the CLI's secret redaction does not apply to them.

Example:

  openlit coding exec --vendor=claude-code -- claude -p "summarise this repo"`,
		Args:          cobra.MinimumNArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return run(cmd, vendor, captureContent, args)
		},
	}
	cmd.Flags().StringVar(&vendor, "vendor", semconv.CodingAgentVendorClaudeCode, "coding agent vendor")
	cmd.Flags().BoolVar(&captureContent, "capture-content", false,
		"send prompts and tool details, which bypass CLI redaction")
	// Everything from the command on belongs to the agent, with or without `--`.
	cmd.Flags().SetInterspersed(false)
	return cmd
}

func run(cmd *cobra.Command, vendor string, captureContent bool, args []string) error {
	// Checked before anything runs: an unsupported vendor is a usage error,
	// unlike a telemetry failure, and would silently produce no data.
	if _, err := nativeEnv(vendor, &config.Resolved{}, "", false, inheritedEnv); err != nil {
		return err
	}

	resolved, err := exec.LookPath(args[0])
	if err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "openlit: could not run %q: %v\n", args[0], err)
		if errors.Is(err, os.ErrPermission) {
			return &ExitError{Code: exitNotExecutable}
		}
		return &ExitError{Code: exitNotFound}
	}

	warn := func(err error) {
		fmt.Fprintf(cmd.ErrOrStderr(), "openlit exec: warning: %v\n", err)
	}

	env := os.Environ()
	var finish func(exitCode int)
	cfg, err := config.Load(nil)
	if err != nil {
		warn(fmt.Errorf("telemetry off: %w", err))
	} else {
		env, finish = startTelemetry(cfg, vendor, filepath.Base(args[0]), captureContent, env, warn)
	}

	exitCode, runErr := runChild(resolved, args[1:], env, cmd)
	if finish != nil {
		finish(exitCode)
	}
	if runErr != nil {
		return runErr
	}
	if exitCode != 0 {
		return &ExitError{Code: exitCode}
	}
	return nil
}

// startTelemetry opens the span and returns the child's environment, with a
// function that closes the span and flushes it.
func startTelemetry(
	cfg *config.Resolved,
	vendor, binary string,
	captureContent bool,
	env []string,
	warn func(error),
) ([]string, func(int)) {
	// The SDK's start-up lines would land in a headless agent's captured stderr.
	log.SetOutput(io.Discard)

	// The span belongs to the agent, not the app that started it: reported under
	// the app's name, it would mark that service as CLI-only in discovery.
	emitterCfg := *cfg
	emitterCfg.ApplicationName = vendor

	emitter, err := otlp.NewEmitter(context.Background(), &emitterCfg, vendor)
	if err != nil {
		warn(fmt.Errorf("telemetry off: %w", err))
		emitter = nil
	}

	traceparent := inheritedEnv("TRACEPARENT")
	var end func(int)
	if emitter != nil {
		traceparent, end = emitter.StartExec(traceparent, binary, captureContent)
	}

	native, err := nativeEnv(vendor, cfg, traceparent, captureContent, inheritedEnv)
	if err != nil {
		warn(err)
		native = nil
	}

	return mergeEnv(env, native), func(exitCode int) {
		if emitter == nil {
			return
		}
		end(exitCode)
		ctx, cancel := context.WithTimeout(context.Background(), flushBudget)
		defer cancel()
		if err := emitter.Shutdown(ctx); err != nil {
			warn(fmt.Errorf("flush: %w", err))
		}
	}
}

func runChild(path string, args, env []string, cmd *cobra.Command) (int, error) {
	child := exec.Command(path, args...) //nolint:gosec // running the given agent is this command's purpose
	child.Env = env
	child.Stdin = cmd.InOrStdin()
	child.Stdout = cmd.OutOrStdout()
	child.Stderr = cmd.ErrOrStderr()

	if err := child.Start(); err != nil {
		if errors.Is(err, os.ErrPermission) {
			return exitNotExecutable, nil
		}
		return 0, fmt.Errorf("start %s: %w", path, err)
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, forwardedSignals...)
	defer signal.Stop(signals)
	done := make(chan struct{})
	defer close(done)
	go func() {
		for {
			select {
			case received := <-signals:
				if shouldForward(received) {
					_ = child.Process.Signal(received)
				}
			case <-done:
				return
			}
		}
	}()

	err := child.Wait()
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitCode(exitErr), nil
	}
	return 0, err
}
