// Package configure implements the `openlit configure` subcommand.
//
// Writes the allow-listed subset of config to ~/.config/openlit/config.env
// (mode 0600). Reads the same file via the shared internal/config package
// for the --show variant.
package configure

import (
	"fmt"

	"github.com/openlit/openlit/cli/internal/config"
	"github.com/spf13/cobra"
)

// NewCmd returns the cobra `configure` subcommand.
func NewCmd() *cobra.Command {
	var (
		endpoint    string
		apiKey      string
		environment string
		appName     string
		capture     string
		show        bool
	)

	cmd := &cobra.Command{
		Use:   "configure",
		Short: "Configure the openlit CLI (writes ~/.config/openlit/config.env)",
		Long: `Configure the openlit CLI's persistent settings.

Examples:

  openlit configure --endpoint https://otlp.openlit.example.com --api-key sk_...
  openlit configure --environment staging
  openlit configure --show

The file is written with mode 0600. Only an explicit allow-list of keys is
honored; anything else is silently ignored. Per-invocation env vars and
flags always take precedence over the file at runtime.`,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if show {
				return runShow(cmd)
			}
			return runWrite(cmd, endpoint, apiKey, environment, appName, capture)
		},
	}

	cmd.Flags().StringVar(&endpoint, "endpoint", "", "OTLP/HTTP endpoint URL (e.g. http://localhost:4318)")
	cmd.Flags().StringVar(&apiKey, "api-key", "", "API key sent as `Authorization: Bearer <key>`")
	cmd.Flags().StringVar(&environment, "environment", "", "Deployment environment (e.g. production, staging)")
	cmd.Flags().StringVar(&appName, "application-name", "", "Application name (default: openlit-cli)")
	cmd.Flags().StringVar(&capture, "content-capture", "", "Coding-agent content capture mode: minimal | metadata_only | full")
	cmd.Flags().BoolVar(&show, "show", false, "Print effective resolved configuration without writing anything")

	return cmd
}

func runWrite(cmd *cobra.Command, endpoint, apiKey, env, app, capture string) error {
	updates := map[string]string{}
	if endpoint != "" {
		updates["OPENLIT_OTLP_ENDPOINT"] = endpoint
	}
	if apiKey != "" {
		updates["OPENLIT_API_KEY"] = apiKey
	}
	if env != "" {
		updates["OPENLIT_ENVIRONMENT"] = env
	}
	if app != "" {
		updates["OPENLIT_APPLICATION_NAME"] = app
	}
	if capture != "" {
		switch capture {
		case "minimal", "metadata_only", "full":
		default:
			return fmt.Errorf("invalid --content-capture %q (allowed: minimal, metadata_only, full)", capture)
		}
		updates["OPENLIT_CODING_CONTENT_CAPTURE"] = capture
	}

	if len(updates) == 0 {
		return fmt.Errorf("nothing to write — pass at least one of --endpoint / --api-key / --environment / --application-name / --content-capture (or use --show)")
	}

	path, err := config.Save(updates)
	if err != nil {
		return fmt.Errorf("save config: %w", err)
	}
	fmt.Fprintf(cmd.OutOrStdout(), "openlit: wrote %d setting(s) to %s\n", len(updates), path)
	return nil
}

func runShow(cmd *cobra.Command) error {
	res, err := config.Load(nil)
	if err != nil {
		return err
	}
	out := cmd.OutOrStdout()
	fmt.Fprintln(out, "Effective configuration:")
	fmt.Fprintf(out, "  otlp_endpoint           = %s   (source: %s)\n", res.OTLPEndpoint, sourceOf(res, "otlp_endpoint"))
	fmt.Fprintf(out, "  api_key                 = %s   (source: %s)\n", redact(res.APIKey), sourceOf(res, "api_key"))
	fmt.Fprintf(out, "  environment             = %s   (source: %s)\n", res.Environment, sourceOf(res, "environment"))
	fmt.Fprintf(out, "  application_name        = %s   (source: %s)\n", res.ApplicationName, sourceOf(res, "application_name"))
	fmt.Fprintf(out, "  coding_content_capture  = %s   (source: %s)\n", res.CodingContentCapture, sourceOf(res, "coding_content_capture"))
	if len(res.OTLPHeaders) > 0 {
		fmt.Fprintf(out, "  otlp_headers (extra)    = %d header(s) (source: %s)\n", len(res.OTLPHeaders), sourceOf(res, "otlp_headers"))
	}
	path, _ := config.Path()
	fmt.Fprintf(out, "\nConfig file: %s\n", path)
	return nil
}

func sourceOf(r *config.Resolved, key string) string {
	if v, ok := r.Source[key]; ok {
		return v
	}
	return "default"
}

// redact returns "(unset)" for empty, otherwise "<first 4 chars>****" so
// `--show` is safe to paste into a screenshot or chat.
func redact(s string) string {
	if s == "" {
		return "(unset)"
	}
	if len(s) <= 4 {
		return "****"
	}
	return s[:4] + "****"
}
