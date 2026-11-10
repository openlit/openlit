package signal

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	// MaxFieldBytes bounds every string a signal carries.
	MaxFieldBytes = 256
	// redactWindow bounds the input the secret patterns scan.
	redactWindow = 1024
	redacted     = "[redacted]"
)

var environmentPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,62}$`)

// secretPatterns catch credentials that end up in attribute values (for
// example a tool argument or URL). Keys are filtered separately by name.
var secretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}`),
	regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{16,}`),
	regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`),
	regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`),
	regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{20,}`),
	regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9-]{10,}`),
	regexp.MustCompile(`\bopenlit-[A-Za-z0-9_-]{16,}`),
	regexp.MustCompile(`(?i)\b(?:api[_-]?key|token|secret|password)=[^\s&]{4,}`),
}

// NormalizeEnvironment lowercases env and reports whether it is a name the
// UI accepts. Signals with other names are dropped, not published.
func NormalizeEnvironment(env string) (string, bool) {
	env = strings.ToLower(strings.TrimSpace(env))
	return env, environmentPattern.MatchString(env)
}

// Clean redacts embedded credentials and truncates to MaxFieldBytes on a
// UTF-8 boundary.
func Clean(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = truncate(value, redactWindow)
	for _, re := range secretPatterns {
		value = re.ReplaceAllString(value, redacted)
	}
	return truncate(value, MaxFieldBytes)
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(value[cut]) {
		cut--
	}
	return value[:cut]
}
