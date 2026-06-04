// Package doctor implements `openlit doctor` — a one-shot self-check
// that prints the active configuration, verifies the OTLP endpoint
// is reachable, and lists installed coding-agent vendor plugins.
//
// Intended use: "my chats aren't appearing in the dashboard, what's
// wrong?". A doctor invocation answers that in <2s without the user
// having to grep their shell rc files or stare at hook subprocess
// logs.
//
// Doctor is intentionally read-only: it never edits config, never
// installs anything, never sends telemetry. Output goes to stdout
// in a single human-readable block plus a final line:
//
//	openlit doctor: ok
//	openlit doctor: ok with warnings
//	openlit doctor: failed
//
// Exit code is 0 for ok / ok-with-warnings and 1 for failed, so a
// CI pipeline that wraps `openlit doctor` can gate on it.
package doctor

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/openlit/openlit/cli/internal/config"
	"github.com/openlit/openlit/cli/internal/version"
	"github.com/spf13/cobra"
)

// NewCmd returns the cobra command for `openlit doctor`.
func NewCmd() *cobra.Command {
	return &cobra.Command{
		Use:           "doctor",
		Short:         "Diagnose openlit's setup (config, OTLP reachability, plugins)",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE:          run,
	}
}

func run(cmd *cobra.Command, _ []string) error {
	out := cmd.OutOrStdout()
	warnings := 0
	failed := 0

	fmt.Fprintf(out, "openlit %s\n", version.Version)
	if version.Commit != "" {
		fmt.Fprintf(out, "  commit: %s\n", version.Commit)
	}

	fmt.Fprintln(out)
	fmt.Fprintln(out, "Configuration")
	cfg, err := config.Load(nil)
	if err != nil {
		fmt.Fprintf(out, "  ERROR: load: %v\n", err)
		failed++
	} else {
		fmt.Fprintf(out, "  otlp_endpoint:        %s\n", maskEmpty(cfg.OTLPEndpoint))
		fmt.Fprintf(out, "  api_key_set:          %v\n", cfg.APIKey != "")
		fmt.Fprintf(out, "  environment:          %s\n", maskEmpty(cfg.Environment))
		fmt.Fprintf(out, "  application_name:     %s\n", maskEmpty(cfg.ApplicationName))
		fmt.Fprintf(out, "  content_capture_mode: %s\n", maskEmpty(cfg.CodingContentCapture))
		if cfg.OTLPEndpoint == "" {
			fmt.Fprintln(out, "  WARN: OTLP endpoint is empty — telemetry won't ship.")
			warnings++
		}
	}

	fmt.Fprintln(out)
	fmt.Fprintln(out, "OTLP reachability")
	if cfg != nil && cfg.OTLPEndpoint != "" {
		host, port, ok := splitOTLP(cfg.OTLPEndpoint)
		if !ok {
			fmt.Fprintf(out, "  WARN: couldn't parse OTLP endpoint %q\n", cfg.OTLPEndpoint)
			warnings++
		} else {
			start := time.Now()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			d := net.Dialer{Timeout: 2 * time.Second}
			conn, derr := d.DialContext(ctx, "tcp", net.JoinHostPort(host, port))
			elapsed := time.Since(start).Round(time.Millisecond)
			if derr != nil {
				fmt.Fprintf(out, "  FAIL: tcp dial %s:%s in %s — %v\n", host, port, elapsed, derr)
				failed++
			} else {
				_ = conn.Close()
				fmt.Fprintf(out, "  ok:   tcp dial %s:%s in %s\n", host, port, elapsed)
			}
		}
	} else {
		fmt.Fprintln(out, "  skipped: no endpoint configured")
	}

	fmt.Fprintln(out)
	fmt.Fprintln(out, "Coding-agent plugins")
	plugins := detectInstalledPlugins()
	if len(plugins) == 0 {
		fmt.Fprintln(out, "  WARN: no vendor plugin install marker found.")
		fmt.Fprintln(out, "        Run `openlit coding install --vendor=cursor` (or claude-code / codex).")
		warnings++
	}
	for _, p := range plugins {
		fmt.Fprintf(out, "  %s: %s\n", p.vendor, p.path)
	}

	fmt.Fprintln(out)
	fmt.Fprintln(out, "Session cache")
	if cache := sessionCachePath(); cache != "" {
		entries := countDirEntries(cache)
		fmt.Fprintf(out, "  %s — %d cached sessions\n", cache, entries)
	} else {
		fmt.Fprintln(out, "  WARN: couldn't resolve user cache dir")
		warnings++
	}

	fmt.Fprintln(out)
	switch {
	case failed > 0:
		fmt.Fprintln(out, "openlit doctor: failed")
		return fmt.Errorf("doctor: %d failure(s), %d warning(s)", failed, warnings)
	case warnings > 0:
		fmt.Fprintf(out, "openlit doctor: ok with %d warning(s)\n", warnings)
	default:
		fmt.Fprintln(out, "openlit doctor: ok")
	}
	return nil
}

func maskEmpty(s string) string {
	if s == "" {
		return "(unset)"
	}
	return s
}

// splitOTLP parses `OTLPEndpoint` and returns the (host, port) pair we
// should dial for reachability. Defaults the port for http/https
// when unspecified.
func splitOTLP(endpoint string) (string, string, bool) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" {
		return "", "", false
	}
	host := u.Hostname()
	port := u.Port()
	if port == "" {
		switch strings.ToLower(u.Scheme) {
		case "https":
			port = "443"
		default:
			port = "80"
		}
	}
	return host, port, true
}

// installedPlugin is a single (vendor, marker file) detection result
// surfaced by `openlit doctor`.
type installedPlugin struct {
	vendor string
	path   string
}

// detectInstalledPlugins probes the openlit-specific markers each
// vendor's install routine writes — not the vendor's own root
// directory, which exists whenever the vendor itself is installed
// regardless of openlit. False positives there made doctor report
// "cursor: installed" for any Cursor user who had never run `openlit
// coding install --vendor=cursor`.
//
// Markers are sourced from cli/internal/coding/install:
//   - cursor:      ~/.cursor/hooks.json containing an `openlit coding hook`
//     command (the install routine merges entries into the
//     user's hooks.json, which may pre-exist with other tools).
//   - claude-code: ~/.claude/plugins/openlit-cc/.claude-plugin/plugin.json,
//     created only by the openlit install.
//   - codex:       ~/.local/share/openlit/codex-marketplace/, the local
//     marketplace tree that `openlit coding install --vendor=codex`
//     materializes and registers with codex.
func detectInstalledPlugins() []installedPlugin {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil
	}
	candidates := []struct {
		vendor string
		path   string
		// verify, when set, is run on the file's contents after a
		// successful stat. The plugin counts as installed only when
		// verify returns true. Used for cursor, where the hooks.json
		// file may belong to another tool entirely.
		verify func([]byte) bool
	}{
		{
			vendor: "cursor",
			path:   filepath.Join(home, ".cursor", "hooks.json"),
			verify: func(b []byte) bool {
				return strings.Contains(string(b), "openlit coding hook") ||
					strings.Contains(string(b), "/.openlit/")
			},
		},
		{
			vendor: "claude-code",
			path:   filepath.Join(home, ".claude", "plugins", "openlit-cc", ".claude-plugin", "plugin.json"),
		},
		{
			vendor: "codex",
			path:   filepath.Join(home, ".local", "share", "openlit", "codex-marketplace"),
		},
	}
	var out []installedPlugin
	for _, c := range candidates {
		info, err := os.Stat(c.path)
		if err != nil {
			continue
		}
		if c.verify != nil {
			if info.IsDir() {
				continue
			}
			body, err := os.ReadFile(c.path)
			if err != nil || !c.verify(body) {
				continue
			}
		}
		out = append(out, installedPlugin{vendor: c.vendor, path: c.path})
	}
	return out
}

// sessionCachePath returns the directory the hook subcommand stores
// per-session state in. Empty string when os.UserCacheDir fails.
func sessionCachePath() string {
	root, err := os.UserCacheDir()
	if err != nil || root == "" {
		return ""
	}
	return filepath.Join(root, "openlit", "sessions")
}

// countDirEntries returns the number of regular files directly inside
// dir, ignoring the .lock siblings. Zero on error.
func countDirEntries(dir string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	n := 0
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(e.Name(), ".lock") {
			continue
		}
		n++
	}
	return n
}
