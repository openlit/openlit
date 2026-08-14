// Package coding hosts the `openlit coding ...` subcommand group.
//
// v1 ships the following children:
//
//	openlit coding hook      --vendor=cc|cursor|codex --event=...
//	openlit coding install   --vendor=all|<single>
//	openlit coding uninstall --vendor=all|<single> [--purge]
//	openlit coding launch    <claude|cursor|codex>
//
// All children share the resolved config from internal/config and the
// OTLP exporter from internal/otlp. The hook subcommand is the hot path
// invoked once per agent event and follows the crash-isolation rules
// documented on cmd/openlit/main.go.
package coding

import (
	"github.com/openlit/openlit/cli/internal/coding/hook"
	"github.com/openlit/openlit/cli/internal/coding/install"
	"github.com/openlit/openlit/cli/internal/coding/launch"
	"github.com/openlit/openlit/cli/internal/coding/uninstall"
	"github.com/spf13/cobra"
)

// NewCmd returns the `coding` cobra command tree.
func NewCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "coding",
		Short: "Coding-agent observability (Claude Code, Cursor, Codex)",
		Long: `Send telemetry from AI coding agents into OpenLit.

Three install paths land at the same plugin manifests under plugins/:
  A) openlit coding launch <claude|cursor|codex>             # one-liner
  B) openlit coding install --vendor=all                     # write manifests, no agent TUI
  C) From inside the agent: /plugin marketplace add openlit/openlit, then install.

To stop tracking, use 'openlit coding uninstall --vendor=<v>' (add
--purge to also drop ~/.config/openlit and the session-state cache).

The 'hook' subcommand is invoked by the host plugin manifests once per
agent event and is the hot path. It always exits 0 on telemetry-path
failure so a broken pipeline never blocks a developer's prompt.`,
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	cmd.AddCommand(hook.NewCmd())
	cmd.AddCommand(install.NewCmd())
	cmd.AddCommand(uninstall.NewCmd())
	cmd.AddCommand(launch.NewCmd())

	return cmd
}
