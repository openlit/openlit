// Package uninstall implements `openlit coding uninstall --vendor=...`.
//
// Inverse of `openlit coding install`: removes the per-vendor host
// plugin manifests that install writes, optionally deregisters the
// plugin from the vendor's own CLI (Claude Code's `claude plugin
// uninstall`, Codex's `codex plugin remove`), and with `--purge` also
// drops the shared OpenLit config and session-state cache.
//
// We separate `--vendor` cleanup from `--purge` so the common
// "I want to stop Cursor from being tracked but keep my Claude Code
// telemetry" case is a single command and doesn't blow away the
// shared API key + endpoint config.
package uninstall

import (
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

// NewCmd returns the cobra command for `openlit coding uninstall`.
func NewCmd() *cobra.Command {
	var (
		vendor string
		purge  bool
		dryRun bool
	)

	cmd := &cobra.Command{
		Use:   "uninstall",
		Short: "Remove per-vendor coding-agent host plugin manifests",
		Long: `Remove host plugin manifests previously written by 'openlit coding install'.

Vendors:
  claude-code   ~/.claude/plugins/openlit-cc/        + 'claude plugin uninstall'
  cursor        strips openlit entries from ~/.cursor/hooks.json (preserves other tools')
  codex         ~/.local/share/openlit/codex-marketplace/ + 'codex plugin remove'
  all           shorthand for all three

Use --purge to also remove the shared OpenLit config (~/.config/openlit)
and the session-state cache. Leave it off if you plan to re-install
later and want to keep your API key + endpoint.

The 'openlit' binary itself is NOT removed by this command. Uninstall
it via the same channel you installed it through (Homebrew, the curl|sh
installer, or 'go install').`,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return run(cmd, vendor, purge, dryRun)
		},
	}

	cmd.Flags().StringVar(&vendor, "vendor", "", "Vendor (claude-code | cursor | codex | all)")
	cmd.Flags().BoolVar(&purge, "purge", false, "Also remove ~/.config/openlit and the session-state cache")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Print what would be removed without modifying any files")
	_ = cmd.MarkFlagRequired("vendor")

	return cmd
}

func run(cmd *cobra.Command, vendor string, purge, dryRun bool) error {
	vendor = strings.ToLower(strings.TrimSpace(vendor))
	if vendor == "" {
		return errors.New("--vendor is required")
	}

	targets, err := vendorsFromArg(vendor)
	if err != nil {
		return err
	}

	out := cmd.OutOrStdout()
	for _, v := range targets {
		removed, vendErrs := uninstallVendor(v, dryRun)
		if dryRun {
			fmt.Fprintf(out, "[dry-run] would remove %d path(s) for %s\n", len(removed), v)
		} else {
			fmt.Fprintf(out, "openlit: removed %s plugin (%d path(s))\n", v, len(removed))
		}
		for _, p := range removed {
			fmt.Fprintf(out, "  - %s\n", p)
		}
		for _, e := range vendErrs {
			fmt.Fprintf(cmd.ErrOrStderr(), "openlit uninstall %s: %s\n", v, e)
		}
	}

	if purge {
		removed, purgeErrs := purgeShared(dryRun)
		if dryRun {
			fmt.Fprintf(out, "[dry-run] --purge would remove %d shared path(s)\n", len(removed))
		} else {
			fmt.Fprintf(out, "openlit: purged %d shared path(s)\n", len(removed))
		}
		for _, p := range removed {
			fmt.Fprintf(out, "  - %s\n", p)
		}
		for _, e := range purgeErrs {
			fmt.Fprintf(cmd.ErrOrStderr(), "openlit uninstall --purge: %s\n", e)
		}
	}

	if !dryRun {
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "Hooks will stop firing on the agent's next session.")
		if !purge {
			fmt.Fprintln(out, "Tip: pass --purge to also drop ~/.config/openlit and the session-state cache.")
		}
	}
	return nil
}

// vendorsFromArg mirrors the install package's accepted vendor IDs so
// the two commands stay in lock-step. We intentionally duplicate the
// switch rather than import install/ to keep uninstall buildable on
// its own (and the surface is small).
func vendorsFromArg(arg string) ([]string, error) {
	switch arg {
	case "all":
		return []string{"claude-code", "cursor", "codex"}, nil
	case "claude-code", "cc":
		return []string{"claude-code"}, nil
	case "cursor":
		return []string{"cursor"}, nil
	case "codex":
		return []string{"codex"}, nil
	default:
		return nil, fmt.Errorf("unknown --vendor %q", arg)
	}
}
