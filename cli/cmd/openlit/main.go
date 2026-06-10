// openlit is the OpenLit command-line tool. v1 ships the `coding`
// subcommand group for AI-coding-agent observability (Claude Code, Cursor,
// Codex). Future subcommand groups (prompts, traces, eval,
// migrate) plug in by registering on the root in `registerSubcommands`.
//
// Crash-isolation guardrails (see internal/coding/hook):
//   - hook subcommand never blocks the developer (always exits 0)
//   - 5s hard timeout per invocation; 3s of that for OTLP flush
//   - never writes to stdout (Claude Code parses stdout for JSON)
//   - panic-recover wrapper around every command body
package main

import (
	"os"

	"github.com/openlit/openlit/cli/internal/coding"
	"github.com/openlit/openlit/cli/internal/configure"
	"github.com/openlit/openlit/cli/internal/doctor"
	"github.com/openlit/openlit/cli/internal/version"
	"github.com/spf13/cobra"
)

func main() {
	root := newRootCmd()
	if err := root.Execute(); err != nil {
		// cobra already prints to stderr; just set the exit code.
		// We never use os.Exit on telemetry-path errors; those swallow
		// inside the command handlers themselves so the agent never
		// sees a non-zero exit. Errors here are misuse (bad flags,
		// unknown subcommands) where exiting non-zero is correct.
		os.Exit(1)
	}
}

func newRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "openlit",
		Short: "OpenLit command-line tool",
		Long: `openlit is the OpenLit command-line tool.

v1 ships the 'coding' subcommand group for AI-coding-agent observability:

  openlit coding install --vendor=all
  openlit coding launch claude
  openlit coding hook --vendor=cc --event=SessionStart

Run 'openlit doctor' to diagnose configuration, OTLP reachability,
and installed plugins in one shot.

Future subcommand groups (prompts, traces, eval) will plug in alongside.

Configure the OTLP endpoint and (optional) API key via:
  - flags:  --otlp-endpoint, --api-key
  - env:    OPENLIT_OTLP_ENDPOINT, OPENLIT_API_KEY
  - or std: OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
  - or file: ~/.config/openlit/config.env (allow-listed keys)
`,
		// Suppress cobra's default usage spam on errors that bubble up
		// from subcommands; the subcommands handle their own messaging.
		SilenceUsage: true,
		// Errors are printed by cobra by default. We keep that for misuse
		// errors (bad flags) but swallow telemetry-path errors inside the
		// subcommand handlers so they never leak to stdout/stderr at all.
		SilenceErrors: false,
	}

	registerSubcommands(root)
	return root
}

// registerSubcommands wires each top-level subcommand group on the root.
// Adding a new group (e.g. `prompts`) is one line here plus a new package
// under cli/internal/<group>/.
func registerSubcommands(root *cobra.Command) {
	root.AddCommand(coding.NewCmd())
	root.AddCommand(configure.NewCmd())
	root.AddCommand(doctor.NewCmd())
	root.AddCommand(version.NewCmd())

	// Future slots — left here intentionally as comments so contributors
	// can see the shape we're building toward without scaffolding empty
	// subtrees that confuse code search:
	//
	//   root.AddCommand(prompts.NewCmd())  // openlit prompts {pull,push,list,diff}
	//   root.AddCommand(traces.NewCmd())   // openlit traces  {tail,query,export}
	//   root.AddCommand(eval.NewCmd())     // openlit eval    {run,list}
	//   root.AddCommand(migrate.NewCmd())  // openlit migrate
	//   root.AddCommand(fleet.NewCmd())    // openlit fleet   {status,list}
}
