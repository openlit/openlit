package signal

import (
	"os"
	"strings"
	"sync"
	"unicode/utf8"
)

// Keep this list in sync with src/engine/internal/signal/attrs.go and
// src/client/src/lib/platform/realtime/attributes.ts.
//
// These are operational span and resource attributes a rule may match or
// group by. Prompt, completion, and message attributes are never copied,
// even when OPENLIT_SIGNAL_ATTRIBUTES names them.

const (
	maxAttributes     = 32
	maxAttributeRunes = 256
)

var defaultAttributes = []string{
	"gen_ai.tool.name",
	"gen_ai.tool.type",
	"gen_ai.response.finish_reasons",
	"gen_ai.request.temperature",
	"gen_ai.request.max_tokens",
	"gen_ai.request.top_p",
	"gen_ai.request.frequency_penalty",
	"gen_ai.request.presence_penalty",
	"gen_ai.request.seed",
	"http.request.method",
	"http.method",
	"http.route",
	"url.path",
	"server.address",
	"server.port",
	"db.system",
	"db.operation.name",
	"user.id",
	"session.id",
	"enduser.id",
	"conversation.id",
	"gen_ai.conversation.id",
	"service.version",
	"deployment.environment",
}

var sensitiveAttributeParts = []string{
	"prompt", "completion", "message", "content", "secret", "password",
	"authorization", "api_key", "apikey", "api-key", "credential", "cookie",
	"bearer", "instruction",
}

var (
	attrMu     sync.RWMutex
	extraAttrs = map[string]struct{}{}
)

func init() {
	setExtraAttributes(os.Getenv("OPENLIT_SIGNAL_ATTRIBUTES"))
}

// SetExtraAttributes replaces the process allowlist extension. Sensitive
// keys and keys that are not identifiers are ignored.
func SetExtraAttributes(raw string) {
	attrMu.Lock()
	defer attrMu.Unlock()
	setExtraAttributes(raw)
}

func setExtraAttributes(raw string) {
	next := map[string]struct{}{}
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\t' }) {
		key := strings.TrimSpace(part)
		if !validAttributeKey(key) || len(next) >= maxAttributes {
			continue
		}
		next[key] = struct{}{}
	}
	extraAttrs = next
}

func validAttributeKey(key string) bool {
	if key == "" || len(key) > 128 || sensitiveAttribute(key) {
		return false
	}
	for i, r := range key {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z':
		case i > 0 && (r == '.' || r == '_' || r == '-' || (r >= '0' && r <= '9')):
		default:
			return false
		}
	}
	return true
}

func sensitiveAttribute(key string) bool {
	lower := strings.ToLower(key)
	for _, part := range sensitiveAttributeParts {
		if strings.Contains(lower, part) {
			return true
		}
	}
	return false
}

// AllowedAttribute reports whether a rule may use this span attribute.
func AllowedAttribute(key string) bool {
	if !validAttributeKey(key) {
		return false
	}
	for _, name := range defaultAttributes {
		if name == key {
			return true
		}
	}
	attrMu.RLock()
	defer attrMu.RUnlock()
	_, ok := extraAttrs[key]
	return ok
}

// Attributes copies allowlisted span attributes, with resource attributes as
// a fallback. Span values win. The result never includes prompt or message text.
func Attributes(span, resource map[string]string) map[string]string {
	if len(span) == 0 && len(resource) == 0 {
		return nil
	}
	keys := make([]string, 0, len(defaultAttributes)+8)
	seen := map[string]struct{}{}
	add := func(key string) {
		if _, ok := seen[key]; ok || !AllowedAttribute(key) {
			return
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	for _, key := range defaultAttributes {
		add(key)
	}
	attrMu.RLock()
	extra := make([]string, 0, len(extraAttrs))
	for key := range extraAttrs {
		extra = append(extra, key)
	}
	attrMu.RUnlock()
	for _, key := range extra {
		add(key)
	}

	out := make(map[string]string)
	for _, key := range keys {
		if len(out) >= maxAttributes {
			break
		}
		value := strings.TrimSpace(span[key])
		if value == "" {
			value = strings.TrimSpace(resource[key])
		}
		if value == "" {
			continue
		}
		if utf8.RuneCountInString(value) > maxAttributeRunes {
			runes := []rune(value)
			value = string(runes[:maxAttributeRunes])
		}
		out[key] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
