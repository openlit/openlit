// Package hook implements `openlit coding hook --vendor=... --event=...`.
//
// This is the hot path: invoked once per agent event by the per-vendor
// host plugin manifests under plugins/<vendor>/. The subcommand reads
// the agent's payload from stdin, normalizes it into coding_agent.* OTel
// spans/events via the per-vendor adapters under hook/<vendor>/, and
// exports via internal/otlp.
//
// Crash isolation rules (non-negotiable):
//   - exits 0 on telemetry-path failure (a broken pipe never blocks the dev)
//   - 5s hard timeout on the entire invocation; 3s of that for OTLP flush
//   - panic-recover wraps the body
//   - never writes to stdout (Claude Code parses stdout for JSON)
package hook

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime/debug"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/hook/claudecode"
	"github.com/openlit/openlit/cli/internal/coding/hook/codex"
	"github.com/openlit/openlit/cli/internal/coding/hook/copilot"
	"github.com/openlit/openlit/cli/internal/coding/hook/cursor"
	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/config"
	"github.com/openlit/openlit/cli/internal/otlp"
	"github.com/spf13/cobra"
)

const (
	// hardTimeout caps the entire hook invocation. Each adapter is
	// expected to finish well under this, but if any part hangs we'd
	// rather drop the data than wedge the agent.
	hardTimeout = 5 * time.Second
	// flushTimeout is reserved at the end for OTLP shutdown/flush.
	flushTimeout = 3 * time.Second
)

// NewCmd returns the cobra command for `openlit coding hook`.
func NewCmd() *cobra.Command {
	var (
		vendor string
		event  string
	)

	cmd := &cobra.Command{
		Use:   "hook",
		Short: "Process a coding-agent hook event (invoked by host plugin manifests)",
		Long: `Process a coding-agent hook event.

Reads the host plugin's payload from stdin, normalizes it to
coding_agent.* OTel spans/events, and exports via OTLP. The subcommand
always exits 0 on telemetry-path failure so a broken telemetry pipeline
never blocks a developer's prompt.`,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return run(cmd, vendor, event)
		},
	}

	cmd.Flags().StringVar(&vendor, "vendor", "", "Vendor: cc | claude-code | cursor | codex | copilot")
	cmd.Flags().StringVar(&event, "event", "", "Hook event name (vendor-specific; e.g. SessionStart, PreToolUse)")
	_ = cmd.MarkFlagRequired("vendor")

	return cmd
}

func run(cmd *cobra.Command, vendor, event string) (rerr error) {
	// Top-level recover — we promise to never crash the host agent.
	defer func() {
		if r := recover(); r != nil {
			logErrorf("hook panic: %v\n%s", r, debug.Stack())
			rerr = nil
		}
	}()

	ctx, cancel := context.WithTimeout(cmd.Context(), hardTimeout)
	defer cancel()

	// Read the entire payload up-front. Hooks send small JSON blobs
	// (a few KB at most), so buffering is fine and lets adapters work
	// against bytes instead of streaming readers.
	payload, err := io.ReadAll(io.LimitReader(os.Stdin, 8<<20)) // 8 MB cap
	if err != nil {
		logErrorf("hook stdin read: %v", err)
		return nil
	}

	// Surface allow-listed values from ~/.config/openlit/config.env
	// into the process environment BEFORE adapters read them. Per-vendor
	// adapters call os.Getenv directly (e.g. for the repo allowlist),
	// so without this step a value set in config.env would be invisible
	// to them. Existing env vars take precedence so a user's shell
	// override always wins.
	if err := config.PromoteFileToEnv(); err != nil {
		logErrorf("hook config-file env promote: %v", err)
		// non-fatal — the rest of the hook can still proceed without it
	}

	cfg, err := config.Load(nil)
	if err != nil {
		logErrorf("hook config load: %v", err)
		return nil
	}

	adapter, err := pickAdapter(vendor)
	if err != nil {
		logErrorf("hook adapter: %v", err)
		return nil
	}

	emit, err := otlp.NewEmitter(ctx, cfg)
	if err != nil {
		logErrorf("hook otlp init: %v", err)
		return nil
	}
	defer func() {
		fctx, fcancel := context.WithTimeout(context.Background(), flushTimeout)
		defer fcancel()
		if ferr := emit.Shutdown(fctx); ferr != nil {
			logErrorf("hook otlp shutdown: %v", ferr)
		}
	}()

	if err := adapter.Handle(ctx, normalize.Input{
		Vendor:        adapter.Vendor(),
		Event:         event,
		Payload:       payload,
		ContentCapture: cfg.CodingContentCapture,
		Emit:          emit,
	}); err != nil {
		logErrorf("hook adapter handle: %v", err)
	}

	// Always succeed back to the agent.
	return nil
}

// pickAdapter resolves the --vendor flag to a hook adapter. Both the long
// vendor name ("claude-code") and the short alias ("cc") are accepted.
func pickAdapter(vendor string) (normalize.Adapter, error) {
	switch vendor {
	case "cc", "claude-code", "claudecode":
		return claudecode.New(), nil
	case "cursor":
		return cursor.New(), nil
	case "codex":
		return codex.New(), nil
	case "copilot":
		return copilot.New(), nil
	case "":
		return nil, errors.New("--vendor is required")
	default:
		return nil, fmt.Errorf("unknown --vendor %q", vendor)
	}
}

// logErrorf writes to stderr only. Stdout is reserved for the agent's
// own JSON channel (Claude Code in particular parses stdout); writing
// to it from a hook can corrupt the session.
func logErrorf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "openlit hook: "+format+"\n", args...)
}
