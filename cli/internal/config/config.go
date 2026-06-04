// Package config resolves the CLI's runtime configuration from (in order):
//
//  1. CLI flags (--otlp-endpoint, --api-key)
//  2. OPENLIT_* environment variables
//  3. OTEL_EXPORTER_OTLP_* environment variables (standard OTel fallback)
//  4. ~/.config/openlit/config.env on Unix, %APPDATA%\openlit\config.env
//     on Windows; honors $XDG_CONFIG_HOME if set. Allow-listed keys; 0600.
//
// Keep this dead simple: no eval-style sourcing of arbitrary shell, no
// secrets in flags' help text. The config file is a flat KEY=VALUE document
// where only an explicit allow-list of keys is honored.
package config

import (
	"bufio"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Resolved holds the effective configuration after all sources are merged.
type Resolved struct {
	// OTLPEndpoint is the OTLP/HTTP base URL (e.g. "http://localhost:4318").
	// Trailing slash and explicit /v1/traces are tolerated; the OTLP
	// exporter normalizes them.
	OTLPEndpoint string

	// APIKey, when non-empty, is sent as `Authorization: Bearer <key>`
	// alongside any OTLPHeaders below.
	APIKey string

	// OTLPHeaders are extra headers (e.g. parsed from
	// OTEL_EXPORTER_OTLP_HEADERS=foo=bar,baz=qux). Merged with the
	// Authorization header derived from APIKey.
	OTLPHeaders map[string]string

	// Environment / ApplicationName flow into the OTel resource attrs.
	Environment     string
	ApplicationName string

	// CodingContentCapture is one of "minimal", "metadata_only",
	// "full". Default is "full" — onboarding feedback was that the
	// default-on metadata-only mode left users staring at empty
	// trace detail panes and (correctly) assuming the integration
	// was broken. The trade-off is that prompt + tool-arg + tool-
	// result bodies land in your collector verbatim, after tier-1
	// secret scrubbing. Switch back to "metadata_only" (or
	// "minimal", which drops per-event spans entirely) when rolling
	// this out across a team where prompts may carry confidential
	// material.
	//
	// "minimal" emits only session bookends + counters, no
	// per-event spans; "metadata_only" emits per-event spans
	// without prompt / tool-arg bodies; "full" includes everything
	// (still secret-scrubbed).
	CodingContentCapture string

	// Source records where each value came from for `openlit configure
	// --show` and debugging.
	Source map[string]string
}

// Flags holds the values parsed from CLI flags. Pass an empty struct
// when invoked from a context that doesn't expose flags.
type Flags struct {
	OTLPEndpoint string
	APIKey       string
}

// Defaults captures hardcoded fallbacks. Kept as a separate struct so
// tests can replace them without touching env or flags.
type Defaults struct {
	OTLPEndpoint         string
	Environment          string
	ApplicationName      string
	CodingContentCapture string
}

func builtinDefaults() Defaults {
	return Defaults{
		OTLPEndpoint:    "http://127.0.0.1:4318",
		Environment:     "default",
		ApplicationName: "openlit-cli",
		// "full" is the onboarding default: the trace detail view
		// is unhelpful without prompt + response bodies, and a
		// missing-content surprise sours first-run UX. Operators
		// rolling this out at scale can override back to
		// "metadata_only" via `openlit configure --content-capture`
		// (or OPENLIT_CODING_CONTENT_CAPTURE). The trace detail UI
		// also surfaces the toggle inline.
		CodingContentCapture: "full",
	}
}

// Allow-listed keys honored from ~/.config/openlit/config.env. Anything
// else is silently ignored (we never want this file to be a vector for
// arbitrary env-injection on the developer's machine).
var allowedFileKeys = map[string]struct{}{
	"OPENLIT_OTLP_ENDPOINT":          {},
	"OPENLIT_API_KEY":                {},
	"OPENLIT_ENVIRONMENT":            {},
	"OPENLIT_APPLICATION_NAME":       {},
	"OPENLIT_CODING_CONTENT_CAPTURE": {},
	"OPENLIT_CODING_REPO_ALLOWLIST":  {},
	"OTEL_EXPORTER_OTLP_ENDPOINT":    {},
	"OTEL_EXPORTER_OTLP_HEADERS":     {},
	"OTEL_RESOURCE_ATTRIBUTES":       {},
}

// PromoteFileToEnv re-exports the config-file values that downstream
// adapters read directly from os.Getenv (e.g. classifier reading
// OPENLIT_CODING_REPO_ALLOWLIST). Without this step, values set in
// ~/.config/openlit/config.env would silently be unavailable to
// per-vendor adapters that bypass the resolved struct. Existing env
// vars take precedence so we never override a real shell setting.
//
// Secret-shaped keys (currently `OPENLIT_API_KEY`) are deliberately
// NOT promoted. They live on the Resolved struct and are passed to
// the OTLP exporter via header injection only. Promoting them to
// the process env would propagate the key to every grandchild we
// fork — including the developer's shell when the hook is invoked
// via `claude code` / `cursor` — which is a needless attack surface
// and a noisy `env` output for anyone debugging the hook.
func PromoteFileToEnv() error {
	vals, err := readConfigFile()
	if err != nil {
		return err
	}
	for k, v := range vals {
		if v == "" {
			continue
		}
		if isSecretKey(k) {
			continue
		}
		if _, exists := os.LookupEnv(k); exists {
			continue
		}
		_ = os.Setenv(k, v)
	}
	return nil
}

// isSecretKey reports whether a config key carries secret material
// that must not be lifted into the process environment. Keep this
// in sync with the allow-list above (any new sensitive key needs an
// entry here AND a comment on the consuming side explaining that it
// stays on the Resolved struct).
func isSecretKey(k string) bool {
	switch k {
	case "OPENLIT_API_KEY":
		return true
	}
	return false
}

// Load resolves config across all sources.
//
// `flags` may be nil when no command-level flags are involved (e.g. the
// hot-path hook subcommand reads only env + file).
func Load(flags *Flags) (*Resolved, error) {
	defaults := builtinDefaults()
	res := &Resolved{
		OTLPHeaders: map[string]string{},
		Source:      map[string]string{},
	}

	// Step 4: file (lowest priority — gets overridden by env and flags).
	fileVals, err := readConfigFile()
	if err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}
	apply := func(src string, key string, val string) {
		if val == "" {
			return
		}
		switch key {
		case "OPENLIT_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_ENDPOINT":
			res.OTLPEndpoint = val
			res.Source["otlp_endpoint"] = src
		case "OPENLIT_API_KEY":
			res.APIKey = val
			res.Source["api_key"] = src
		case "OPENLIT_ENVIRONMENT":
			res.Environment = val
			res.Source["environment"] = src
		case "OPENLIT_APPLICATION_NAME":
			res.ApplicationName = val
			res.Source["application_name"] = src
		case "OPENLIT_CODING_CONTENT_CAPTURE":
			res.CodingContentCapture = val
			res.Source["coding_content_capture"] = src
		case "OTEL_EXPORTER_OTLP_HEADERS":
			for k, v := range parseOTLPHeaders(val) {
				res.OTLPHeaders[k] = v
			}
			res.Source["otlp_headers"] = src
		}
	}

	for k, v := range fileVals {
		apply("file", k, v)
	}

	// Step 3: standard OTel env vars.
	for _, k := range []string{
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OTEL_EXPORTER_OTLP_HEADERS",
	} {
		if v := os.Getenv(k); v != "" {
			apply("env_otel", k, v)
		}
	}

	// Step 2: OPENLIT_* env vars (override OTel ones).
	for _, k := range []string{
		"OPENLIT_OTLP_ENDPOINT",
		"OPENLIT_API_KEY",
		"OPENLIT_ENVIRONMENT",
		"OPENLIT_APPLICATION_NAME",
		"OPENLIT_CODING_CONTENT_CAPTURE",
	} {
		if v := os.Getenv(k); v != "" {
			apply("env_openlit", k, v)
		}
	}

	// Step 1: flags (highest priority).
	if flags != nil {
		if flags.OTLPEndpoint != "" {
			res.OTLPEndpoint = flags.OTLPEndpoint
			res.Source["otlp_endpoint"] = "flag"
		}
		if flags.APIKey != "" {
			res.APIKey = flags.APIKey
			res.Source["api_key"] = "flag"
		}
	}

	// Apply defaults for anything still empty.
	if res.OTLPEndpoint == "" {
		res.OTLPEndpoint = defaults.OTLPEndpoint
		res.Source["otlp_endpoint"] = "default"
	}
	if res.Environment == "" {
		res.Environment = defaults.Environment
		res.Source["environment"] = "default"
	}
	if res.ApplicationName == "" {
		res.ApplicationName = defaults.ApplicationName
		res.Source["application_name"] = "default"
	}
	if res.CodingContentCapture == "" {
		res.CodingContentCapture = defaults.CodingContentCapture
		res.Source["coding_content_capture"] = "default"
	}

	// Sanity-check the endpoint once so later code doesn't have to.
	if _, err := url.Parse(res.OTLPEndpoint); err != nil {
		return nil, fmt.Errorf("invalid OTLP endpoint %q: %w", res.OTLPEndpoint, err)
	}

	// Quietly upgrade scheme-less or http:// endpoints to https://
	// when the host is non-loopback. The CLI ships an API key in
	// the Authorization header on every OTLP request; sending that
	// in plaintext over a public network is the single highest-impact
	// security regression we can prevent at config-resolution time.
	// Loopback / RFC1918 hosts are preserved as-is so local devs and
	// in-cluster collectors keep working without TLS.
	res.OTLPEndpoint = upgradeScheme(res.OTLPEndpoint)

	return res, nil
}

// upgradeScheme rewrites the OTLP endpoint to https:// when the host
// looks non-local. Inputs without a scheme are interpreted as host
// strings (e.g. `otel.example.com:4318` -> `https://otel.example.com:4318`).
// Empty input returns "" unchanged.
func upgradeScheme(endpoint string) string {
	if endpoint == "" {
		return endpoint
	}
	raw := endpoint
	if !strings.Contains(raw, "://") {
		raw = "//" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return endpoint
	}
	host := u.Hostname()
	if isLocalHost(host) {
		// Default to http for loopback if no scheme; preserve any
		// explicit scheme the operator passed.
		if u.Scheme == "" {
			u.Scheme = "http"
			return u.String()
		}
		return endpoint
	}
	switch strings.ToLower(u.Scheme) {
	case "", "http":
		u.Scheme = "https"
		return u.String()
	default:
		return endpoint
	}
}

// isLocalHost recognises the host strings we treat as trusted-network
// for the purposes of the https-upgrade rule.
func isLocalHost(host string) bool {
	if host == "" {
		return true
	}
	switch strings.ToLower(host) {
	case "localhost", "127.0.0.1", "::1", "0.0.0.0":
		return true
	}
	// RFC1918 / link-local: treat as local. These are the same prefixes
	// kube-internal collectors usually live on, so they stay http://.
	for _, prefix := range []string{
		"10.",
		"192.168.",
		"169.254.",
	} {
		if strings.HasPrefix(host, prefix) {
			return true
		}
	}
	// 172.16.0.0/12 — slightly fiddly; check the second octet range.
	if strings.HasPrefix(host, "172.") {
		var oct int
		_, _ = fmt.Sscanf(host, "172.%d.", &oct)
		if oct >= 16 && oct <= 31 {
			return true
		}
	}
	return false
}

// Path returns the absolute path to the config file, even if it doesn't
// yet exist. Used by `openlit configure` for write-side and by Load for
// read-side.
func Path() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.env"), nil
}

// configDir returns the directory that holds config.env. Honors
// XDG_CONFIG_HOME, falling back to $HOME/.config/openlit/. We do not
// path-traverse the value — env that contains ".." or absolute paths is
// taken at face value here; the consumer (Load/Save) only reads/writes
// the explicit "config.env" leaf which can't escape via traversal.
func configDir() (string, error) {
	if x := os.Getenv("XDG_CONFIG_HOME"); x != "" {
		return filepath.Join(x, "openlit"), nil
	}
	// On Windows the idiomatic config root is %APPDATA% (Roaming).
	// os.UserConfigDir returns exactly that on Windows, whereas on
	// macOS/Linux it returns paths we deliberately do NOT want
	// (~/Library/Application Support and ~/.config respectively —
	// the latter matches but is also what we already use, and on
	// macOS we want the XDG-style ~/.config/openlit/ for parity with
	// Linux so users moving between hosts find the same file).
	if runtime.GOOS == "windows" {
		if cfg, err := os.UserConfigDir(); err == nil && cfg != "" {
			return filepath.Join(cfg, "openlit"), nil
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("could not resolve home directory: %w", err)
	}
	return filepath.Join(home, ".config", "openlit"), nil
}

// readConfigFile parses ~/.config/openlit/config.env if it exists. Returns
// an empty map (no error) if the file is missing — that's the expected
// state on a fresh install.
func readConfigFile() (map[string]string, error) {
	path, err := Path()
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path) //nolint:gosec // path is constructed from $HOME, not user input
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close() //nolint:errcheck

	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		val = strings.Trim(val, `"'`)
		if _, allowed := allowedFileKeys[key]; !allowed {
			continue
		}
		out[key] = val
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// Save writes the supplied key/value pairs to ~/.config/openlit/config.env
// with mode 0600. Existing keys are preserved unless overridden; unknown
// (non-allowlisted) keys are dropped silently.
func Save(updates map[string]string) (string, error) {
	path, err := Path()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}

	existing, err := readConfigFile()
	if err != nil {
		return "", err
	}
	for k, v := range updates {
		if _, ok := allowedFileKeys[k]; !ok {
			continue
		}
		if v == "" {
			delete(existing, k)
			continue
		}
		existing[k] = v
	}

	// Stable ordering: sort keys alphabetically so diffs are clean.
	var lines []string
	lines = append(lines,
		"# openlit CLI config — written by `openlit configure`.",
		"# Allow-listed keys only; anything else is ignored at read time.",
		"",
	)
	keys := make([]string, 0, len(existing))
	for k := range existing {
		keys = append(keys, k)
	}
	sortStrings(keys)
	for _, k := range keys {
		lines = append(lines, fmt.Sprintf("%s=%s", k, existing[k]))
	}

	body := strings.Join(lines, "\n") + "\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		return "", err
	}
	return path, nil
}

// parseOTLPHeaders reads the comma-separated `k=v,k=v` form used by
// OTEL_EXPORTER_OTLP_HEADERS.
func parseOTLPHeaders(s string) map[string]string {
	out := map[string]string{}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		k, v, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if k == "" {
			continue
		}
		out[k] = v
	}
	return out
}

// EffectiveHeaders merges the API-key-derived Authorization header with
// any OTLPHeaders set explicitly via env. Kept as a small helper so the
// OTLP exporter and `openlit configure --show` agree on one truth.
func (r *Resolved) EffectiveHeaders() map[string]string {
	out := map[string]string{}
	for k, v := range r.OTLPHeaders {
		out[k] = v
	}
	if r.APIKey != "" {
		out["Authorization"] = "Bearer " + r.APIKey
	}
	return out
}

// sortStrings is an inline sort helper to avoid pulling in the `sort`
// package indirectly via the test-runner; the cost is one tiny function.
func sortStrings(s []string) {
	// Insertion sort — list is always small (<20 keys).
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j-1] > s[j]; j-- {
			s[j-1], s[j] = s[j], s[j-1]
		}
	}
}
