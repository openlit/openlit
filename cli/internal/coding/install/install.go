// Package install implements `openlit coding install --vendor=...`.
//
// Writes per-vendor host plugin manifests to the user's home directory
// so the agent (Claude Code, Cursor, Codex, Copilot) finds them on next
// launch. The manifest payloads themselves live under cli/internal/coding/install/plugins/
// and are embedded into the binary at build time, so a single statically-
// linked CLI carries everything.
package install

import (
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

// NewCmd returns the cobra command for `openlit coding install`.
func NewCmd() *cobra.Command {
	var (
		vendor string
		dryRun bool
	)

	cmd := &cobra.Command{
		Use:   "install",
		Short: "Install per-vendor coding-agent host plugin manifests",
		Long: `Install per-vendor host plugin manifests so coding agents pipe
telemetry through 'openlit coding hook'.

Vendors:
  claude-code   Claude Code's hooks + plugin manifest
  cursor        Cursor's hooks + run.sh PATH-probe wrapper
  codex         Codex's hooks
  copilot       Copilot CLI's hooks
  all           shorthand for all four

The 'openlit' binary itself must be on PATH. Install via Homebrew, the
prebuilt binaries on GitHub Releases, the curl|sh installer, or
'go install github.com/openlit/openlit/cli/cmd/openlit@latest'.`,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return run(cmd, vendor, dryRun)
		},
	}

	cmd.Flags().StringVar(&vendor, "vendor", "", "Vendor (claude-code | cursor | codex | copilot | all)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Print what would be written without modifying any files")
	_ = cmd.MarkFlagRequired("vendor")

	return cmd
}

func run(cmd *cobra.Command, vendor string, dryRun bool) error {
	vendor = strings.ToLower(strings.TrimSpace(vendor))
	if vendor == "" {
		return errors.New("--vendor is required")
	}

	targets, err := vendorsFromArg(vendor)
	if err != nil {
		return err
	}

	for _, v := range targets {
		written, err := installVendor(v, dryRun)
		if err != nil {
			return fmt.Errorf("install %s: %w", v, err)
		}
		if dryRun {
			fmt.Fprintf(cmd.OutOrStdout(), "[dry-run] would write %d file(s) for %s\n", len(written), v)
		} else {
			fmt.Fprintf(cmd.OutOrStdout(), "openlit: installed %s plugin (%d file(s))\n", v, len(written))
		}
		for _, p := range written {
			fmt.Fprintf(cmd.OutOrStdout(), "  - %s\n", p)
		}
	}
	return nil
}

// vendorsFromArg expands the --vendor argument into a slice of vendor IDs.
func vendorsFromArg(arg string) ([]string, error) {
	switch arg {
	case "all":
		return []string{"claude-code", "cursor", "codex", "copilot"}, nil
	case "claude-code", "cc":
		return []string{"claude-code"}, nil
	case "cursor":
		return []string{"cursor"}, nil
	case "codex":
		return []string{"codex"}, nil
	case "copilot":
		return []string{"copilot"}, nil
	default:
		return nil, fmt.Errorf("unknown --vendor %q", arg)
	}
}
