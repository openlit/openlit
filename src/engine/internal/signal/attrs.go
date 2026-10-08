package signal

import (
	"os"
	"strconv"
	"strings"
	"sync"
)

// Keep this list in sync with src/otlp-receiver/internal/signal/attrs.go and
// src/client/src/lib/platform/realtime/attributes.ts.

const maxAttributes = 32

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

func stringBuiltin(name string) bool {
	switch name {
	case "service", "model", "provider", "operation", "status", "error_type", "environment", "span_name":
		return true
	}
	return false
}

func numericBuiltin(name string) bool {
	switch name {
	case "http_status", "duration_ms", "input_tokens", "output_tokens", "total_tokens", "cost":
		return true
	}
	return false
}

// Known reports whether a match condition may name this field.
func Known(name string) bool {
	return stringBuiltin(name) || numericBuiltin(name) || AllowedAttribute(name)
}

// Groupable reports whether a window may group by this field.
func Groupable(name string) bool {
	return stringBuiltin(name) || AllowedAttribute(name)
}

func (s Signal) attribute(name string) (string, bool) {
	if !AllowedAttribute(name) {
		return "", false
	}
	if s.Attrs == nil {
		return "", true
	}
	return s.Attrs[name], true
}

func (s Signal) attributeNumber(name string) (float64, bool) {
	raw, ok := s.attribute(name)
	if !ok || strings.TrimSpace(raw) == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0, false
	}
	return value, true
}
