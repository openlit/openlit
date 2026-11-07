package agentexec

import (
	"fmt"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"

	"github.com/openlit/openlit/cli/internal/config"
	"github.com/openlit/openlit/sdk/go/semconv"
)

// inheritedEnv reads this process's environment. A variable, so tests can pass
// their own to nativeEnv directly.
var inheritedEnv = os.Getenv

var validTraceparent = regexp.MustCompile(`^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$`)

// removedFromChild reports inherited variables that would undo what exec sets
// up. An inherited service name would stop the Agents hub recognising the
// vendor, and inherited content flags would export prompts, tool content or raw
// API bodies nobody asked exec to send. Every OTEL_LOG_* flag goes, because a
// vendor may add more, except OTEL_LOG_LEVEL, which carries no content.
func removedFromChild(key string) bool {
	if key == "OTEL_SERVICE_NAME" {
		return true
	}
	return strings.HasPrefix(key, "OTEL_LOG_") && key != "OTEL_LOG_LEVEL"
}

// encodeOTELValue percent-encodes for the OTEL_* `key=value,...` format.
// PathEscape leaves `=` alone, and OTel JS discards the whole variable on a
// value containing one.
func encodeOTELValue(value string) string {
	return strings.ReplaceAll(url.PathEscape(value), "=", "%3D")
}

// nativeEnv returns the variables that switch on a vendor's own telemetry.
// Restricted and headless modes can turn hooks off, and these still apply.
//
// service.name stays the vendor's: the Agents hub tile identifies native Claude
// Code spans by it. Native spans bypass the CLI, and with it redaction, so
// prompts are sent only when the caller asks with captureContent.
func nativeEnv(
	vendor string,
	cfg *config.Resolved,
	traceparent string,
	captureContent bool,
	inherited func(string) string,
) (map[string]string, error) {
	if vendor != semconv.CodingAgentVendorClaudeCode {
		return nil, fmt.Errorf("no native telemetry settings for vendor %q (allowed: %s)",
			vendor, semconv.CodingAgentVendorClaudeCode)
	}

	var resource []string
	if existing := inherited("OTEL_RESOURCE_ATTRIBUTES"); existing != "" {
		resource = append(resource, existing)
	}
	resource = append(resource, "gen_ai.agent.name="+vendor)
	if source := cfg.Source["application_name"]; cfg.ApplicationName != "" && source != "default" && source != "" {
		resource = append(resource, "openlit.caller.service="+encodeOTELValue(cfg.ApplicationName))
	}

	env := map[string]string{
		"CLAUDE_CODE_ENABLE_TELEMETRY":        "1",
		"CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",
		"OTEL_METRICS_EXPORTER":               "otlp",
		"OTEL_LOGS_EXPORTER":                  "otlp",
		"OTEL_TRACES_EXPORTER":                "otlp",
		"OTEL_METRICS_INCLUDE_SESSION_ID":     "1",
		"OTEL_METRICS_INCLUDE_VERSION":        "1",
	}
	if inherited("OTEL_EXPORTER_OTLP_PROTOCOL") == "" {
		env["OTEL_EXPORTER_OTLP_PROTOCOL"] = "http/json"
	}
	if cfg.OTLPEndpoint != "" {
		env["OTEL_EXPORTER_OTLP_ENDPOINT"] = cfg.OTLPEndpoint
	}
	if headers := headerList(cfg.EffectiveHeaders()); headers != "" {
		env["OTEL_EXPORTER_OTLP_HEADERS"] = headers
	}
	if validTraceparent.MatchString(traceparent) {
		parts := strings.Split(traceparent, "-")
		env["TRACEPARENT"] = traceparent
		resource = append(resource, "openlit.parent.trace_id="+parts[1], "openlit.parent.span_id="+parts[2])
	}
	if captureContent {
		env["OTEL_LOG_USER_PROMPTS"] = "1"
		env["OTEL_LOG_TOOL_DETAILS"] = "1"
	}
	env["OTEL_RESOURCE_ATTRIBUTES"] = strings.Join(resource, ",")
	return env, nil
}

func headerList(headers map[string]string) string {
	pairs := make([]string, 0, len(headers))
	for key, value := range headers {
		pairs = append(pairs, key+"="+encodeOTELValue(value))
	}
	sort.Strings(pairs)
	return strings.Join(pairs, ",")
}

// mergeEnv lays overrides on top of base and takes out removedFromChild, unless
// an override sets the key again.
func mergeEnv(base []string, overrides map[string]string) []string {
	merged := make([]string, 0, len(base)+len(overrides))
	for _, entry := range base {
		key, _, _ := strings.Cut(entry, "=")
		if _, replaced := overrides[key]; !replaced && !removedFromChild(key) {
			merged = append(merged, entry)
		}
	}
	keys := make([]string, 0, len(overrides))
	for key := range overrides {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		merged = append(merged, key+"="+overrides[key])
	}
	return merged
}
