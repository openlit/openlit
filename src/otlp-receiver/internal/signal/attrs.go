package signal

import (
	"os"
	"sort"
	"strings"
	"sync"
)

// Keep these rules in sync with src/engine/internal/signal/attrs.go and
// src/client/src/lib/platform/realtime/attributes.ts.
//
// Rules may match or group by any span or resource attribute. Prompt,
// completion, message, and secret attributes are never copied, even when
// OPENLIT_SIGNAL_ATTRIBUTES names them. Personal keys (user, session, and
// conversation ids, email, phone, IP, URL paths, server addresses) only cross
// the bus when an operator lists them in OPENLIT_SIGNAL_ATTRIBUTES. The
// defaults below are copied first, so they survive the per-span cap.

const maxAttributes = 64

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
	"server.port",
	"db.system",
	"db.operation.name",
	"service.version",
	"deployment.environment",
}

// OptInAttributes are recognised but never copied unless named in
// OPENLIT_SIGNAL_ATTRIBUTES.
var OptInAttributes = []string{
	"user.id",
	"enduser.id",
	"session.id",
	"conversation.id",
	"gen_ai.conversation.id",
	"url.path",
	"server.address",
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

// builtinFields are signal fields the engine reads from the span itself.
var builtinFields = map[string]struct{}{
	"service": {}, "model": {}, "provider": {}, "operation": {}, "status": {}, "error_type": {},
	"environment": {}, "span_name": {}, "http_status": {}, "duration_ms": {}, "input_tokens": {},
	"output_tokens": {}, "total_tokens": {}, "cost": {},
}

// personalSegments mark attributes that identify people or reveal private
// locations (user, session, and conversation ids, email, phone, IP, URL
// paths, server addresses). Any key containing one of these segments is
// forwarded and matchable only when OPENLIT_SIGNAL_ATTRIBUTES names it.
var personalSegments = map[string]struct{}{
	"user": {}, "enduser": {}, "session": {}, "conversation": {}, "email": {},
	"phone": {}, "ip": {}, "address": {}, "path": {},
}

func personalAttribute(key string) bool {
	lower := strings.ToLower(key)
	if strings.Contains(lower, "email") || strings.Contains(lower, "phone") {
		return true
	}
	for _, segment := range attributeSegments(key) {
		if _, ok := personalSegments[segment]; ok {
			return true
		}
	}
	return false
}

// attributeSegments splits a key on '.', '_', '-' and camelCase boundaries,
// lowercased: "client.userId" -> client, user, id.
func attributeSegments(key string) []string {
	var segments []string
	var current []rune
	var prev rune
	flush := func() {
		if len(current) > 0 {
			segments = append(segments, strings.ToLower(string(current)))
			current = current[:0]
		}
	}
	for _, r := range key {
		switch {
		case r == '.' || r == '_' || r == '-':
			flush()
		case r >= 'A' && r <= 'Z' && ((prev >= 'a' && prev <= 'z') || (prev >= '0' && prev <= '9')):
			flush()
			current = append(current, r)
		default:
			current = append(current, r)
		}
		prev = r
	}
	flush()
	return segments
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

// AllowedAttribute reports whether a rule may use this span attribute: any
// well-formed key that is not sensitive, and personal keys only when
// OPENLIT_SIGNAL_ATTRIBUTES names them.
func AllowedAttribute(key string) bool {
	// Built-in field names always mean the built-in field in the engine.
	if !validAttributeKey(key) {
		return false
	}
	if _, ok := builtinFields[key]; ok {
		return false
	}
	if !personalAttribute(key) {
		return true
	}
	attrMu.RLock()
	defer attrMu.RUnlock()
	_, ok := extraAttrs[key]
	return ok
}

// Attributes copies the span's attributes onto the signal so rules can match
// or group by any of them, with resource attributes as a fallback (span values
// win). Well-known operational keys go first, then the rest in key order, up to
// maxAttributes. Sensitive keys (prompt, message, secret, ...) are never
// copied; personal keys only when configured. Values are redacted and
// truncated by Clean.
func Attributes(span, resource map[string]string) map[string]string {
	if len(span) == 0 && len(resource) == 0 {
		return nil
	}
	out := make(map[string]string)
	add := func(key string) {
		if len(out) >= maxAttributes {
			return
		}
		if _, ok := out[key]; ok || !AllowedAttribute(key) {
			return
		}
		value := Clean(span[key])
		if value == "" {
			value = Clean(resource[key])
		}
		if value != "" {
			out[key] = value
		}
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
	sort.Strings(extra)
	for _, key := range extra {
		add(key)
	}
	for _, source := range []map[string]string{span, resource} {
		keys := make([]string, 0, len(source))
		for key := range source {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			add(key)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
