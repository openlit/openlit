// Package version exposes the CLI build version and a `version` subcommand.
package version

import (
	"fmt"

	"github.com/spf13/cobra"
)

// Version is the CLI's semver string. Overridden at build time via
// `-ldflags "-X github.com/openlit/openlit/cli/internal/version.Version=v1.2.3"`.
// The default `dev` is what local `go build` produces.
var Version = "dev"

// Commit is the short commit SHA, set at build time via -ldflags.
var Commit = ""

// NewCmd returns the cobra `version` subcommand.
func NewCmd() *cobra.Command {
	return &cobra.Command{
		Use:           "version",
		Short:         "Print the openlit CLI version",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			out := cmd.OutOrStdout()
			if Commit != "" {
				_, err := fmt.Fprintf(out, "openlit %s (%s)\n", Version, Commit)
				return err
			}
			_, err := fmt.Fprintf(out, "openlit %s\n", Version)
			return err
		},
	}
}
