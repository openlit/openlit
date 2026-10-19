// Package engine evaluates realtime rules over OpenLIT Signals. Windows are
// keyed by rule + organisation + project + environment + group values, so
// state from one tenant can never influence another tenant's finding.
package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/openlit/openlit/engine/internal/rules"
	"github.com/openlit/openlit/engine/internal/signal"
)

const (
	StateFiring   = "firing"
	StateResolved = "resolved"
)

type SampleRef struct {
	TraceID  string `json:"traceId,omitempty"`
	SpanID   string `json:"spanId,omitempty"`
	Service  string `json:"service,omitempty"`
	Model    string `json:"model,omitempty"`
	Provider string `json:"provider,omitempty"`
}

type Finding struct {
	RuleID         string            `json:"ruleId"`
	RuleName       string            `json:"ruleName"`
	Kind           string            `json:"kind"`
	Mode           string            `json:"mode"`
	Severity       string            `json:"severity"`
	State          string            `json:"state"`
	OrganisationID string            `json:"organisationId"`
	ProjectID      string            `json:"projectId"`
	Environment    string            `json:"environment"`
	Group          map[string]string `json:"group"`
	Metric         string            `json:"metric,omitempty"`
	Operator       string            `json:"operator,omitempty"`
	Value          float64           `json:"value"`
	Threshold      float64           `json:"threshold"`
	WindowSec      int               `json:"windowSec,omitempty"`
	SampleCount    int               `json:"sampleCount"`
	DedupeKey      string            `json:"dedupeKey"`
	ObservedAt     time.Time         `json:"observedAt"`
	Sample         SampleRef         `json:"sample"`
}

type Sink interface {
	Emit(Finding)
}

// environmentPattern matches the environment names the UI accepts.
var environmentPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,62}$`)

type tenantKey struct {
	org, project, env string
}

type window struct {
	ruleID     string
	tenant     tenantKey
	group      map[string]string
	samples    []rules.Sample
	firing     bool
	lastFired  time.Time
	lastSample time.Time
	last       SampleRef
}

// Limits bound the state one tenant (or all tenants together) can create.
// Group values come from span data, so without caps a single API key could
// grow windows, samples, and findings without limit.
type Limits struct {
	MaxWindows          int
	MaxWindowsPerTenant int
	// MaxWindowsPerRule keeps one alert grouped by a high-cardinality field
	// (such as a response id) from using every window its tenant has.
	MaxWindowsPerRule   int
	MaxSamplesPerWindow int
	FindingsPerMinute   int
	MaxRecentTenants    int
	RecentPerTenant     int
}

func DefaultLimits() Limits {
	return Limits{
		MaxWindows:          50000,
		MaxWindowsPerTenant: 1000,
		MaxWindowsPerRule:   200,
		MaxSamplesPerWindow: 5000,
		FindingsPerMinute:   60,
		MaxRecentTenants:    1000,
		RecentPerTenant:     recentPerTenant,
	}
}

type Engine struct {
	mu             sync.Mutex
	rules          map[string]rules.Rule
	windows        map[string]*window
	tenantWindows  map[tenantKey]int
	ruleWindows    map[string]int
	instantLast    map[string]time.Time
	findingBuckets map[tenantKey]*findingBucket
	sink           Sink
	now            func() time.Time
	limits         Limits
	recent         recentStore
	pending        []Finding
	observed       uint64
	emitted        uint64
	invalid        uint64
	droppedWindows uint64
	limited        uint64
}

type findingBucket struct {
	tokens float64
	last   time.Time
}

func New(sink Sink) *Engine {
	e := &Engine{
		rules:          map[string]rules.Rule{},
		windows:        map[string]*window{},
		tenantWindows:  map[tenantKey]int{},
		ruleWindows:    map[string]int{},
		instantLast:    map[string]time.Time{},
		findingBuckets: map[tenantKey]*findingBucket{},
		sink:           sink,
		now:            time.Now,
	}
	e.SetLimits(DefaultLimits())
	return e
}

// SetLimits replaces the state caps. Non-positive values keep the defaults.
func (e *Engine) SetLimits(l Limits) {
	d := DefaultLimits()
	pick := func(v, fallback int) int {
		if v > 0 {
			return v
		}
		return fallback
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.limits = Limits{
		MaxWindows:          pick(l.MaxWindows, d.MaxWindows),
		MaxWindowsPerTenant: pick(l.MaxWindowsPerTenant, d.MaxWindowsPerTenant),
		MaxWindowsPerRule:   pick(l.MaxWindowsPerRule, d.MaxWindowsPerRule),
		MaxSamplesPerWindow: pick(l.MaxSamplesPerWindow, d.MaxSamplesPerWindow),
		FindingsPerMinute:   pick(l.FindingsPerMinute, d.FindingsPerMinute),
		MaxRecentTenants:    pick(l.MaxRecentTenants, d.MaxRecentTenants),
		RecentPerTenant:     pick(l.RecentPerTenant, d.RecentPerTenant),
	}
	e.recent.configure(e.limits.MaxRecentTenants, e.limits.RecentPerTenant)
}

// SetRules replaces the active rule set. Invalid rules are skipped and
// windows belonging to removed or changed rules are dropped.
func (e *Engine) SetRules(rs []rules.Rule) int {
	next := make(map[string]rules.Rule, len(rs))
	for _, r := range rs {
		if err := r.Validate(); err != nil {
			log.Printf("engine: skipping rule: %v", err)
			continue
		}
		next[r.ID] = r
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	for key, w := range e.windows {
		old, okOld := e.rules[w.ruleID]
		cur, okNew := next[w.ruleID]
		if !okNew || !okOld || old.WindowSec != cur.WindowSec || old.Metric != cur.Metric || strings.Join(old.GroupBy, ",") != strings.Join(cur.GroupBy, ",") {
			e.dropWindow(key, w)
		}
	}
	e.rules = next
	return len(next)
}

func (e *Engine) Observe(s signal.Signal, at time.Time) {
	if s.OrganisationID == "" || s.ProjectID == "" || s.Environment == "" {
		return
	}
	s.Environment = strings.ToLower(strings.TrimSpace(s.Environment))
	e.mu.Lock()
	defer e.flush()
	if !environmentPattern.MatchString(s.Environment) {
		e.invalid++
		return
	}
	e.observed++
	e.recent.remember(s, at)
	tk := tenantKey{s.OrganisationID, s.ProjectID, s.Environment}
	ref := SampleRef{TraceID: s.TraceID, SpanID: s.SpanID, Service: s.Service, Model: s.Model, Provider: s.Provider}
	for _, r := range e.rules {
		if !r.InScope(s) {
			continue
		}
		if r.Mode == rules.ModeWindow && !r.Matches(s) {
			continue
		}
		group, ok := r.GroupValues(s)
		if !ok {
			continue
		}
		key := windowKey(r.ID, tk, group)
		if r.Mode == rules.ModeInstant {
			if !r.Matches(s) {
				continue
			}
			nowT := e.now()
			last, seen := e.instantLast[key]
			if seen && nowT.Sub(last) < time.Duration(r.Cooldown())*time.Second {
				continue
			}
			if !seen && len(e.instantLast) >= e.limits.MaxWindows {
				e.droppedWindows++
				continue
			}
			if !e.allowFinding(tk, nowT) {
				continue
			}
			e.instantLast[key] = nowT
			e.emit(Finding{
				RuleID: r.ID, RuleName: r.Name, Kind: r.Kind, Mode: r.Mode, Severity: r.Severity,
				State:          StateFiring,
				OrganisationID: tk.org, ProjectID: tk.project, Environment: tk.env,
				Group: group, Value: 1, Threshold: r.Threshold, SampleCount: 1,
				DedupeKey: dedupeKey(key), ObservedAt: at.UTC(), Sample: ref,
			})
			continue
		}
		w := e.windows[key]
		if w == nil {
			if len(e.windows) >= e.limits.MaxWindows || e.tenantWindows[tk] >= e.limits.MaxWindowsPerTenant ||
				e.ruleWindows[r.ID] >= e.limits.MaxWindowsPerRule {
				e.droppedWindows++
				continue
			}
			w = &window{ruleID: r.ID, tenant: tk, group: group}
			e.windows[key] = w
			e.tenantWindows[tk]++
			e.ruleWindows[r.ID]++
		}
		w.samples = append(w.samples, rules.SampleOf(s, at.UnixMilli()))
		if max := e.limits.MaxSamplesPerWindow; len(w.samples) > max {
			// Shift in place so the backing array does not grow forever.
			n := copy(w.samples, w.samples[len(w.samples)-max:])
			w.samples = w.samples[:n]
		}
		w.lastSample = e.now()
		w.last = ref
	}
}

func (e *Engine) dropWindow(key string, w *window) {
	delete(e.windows, key)
	if n := e.tenantWindows[w.tenant] - 1; n > 0 {
		e.tenantWindows[w.tenant] = n
	} else {
		delete(e.tenantWindows, w.tenant)
	}
	if n := e.ruleWindows[w.ruleID] - 1; n > 0 {
		e.ruleWindows[w.ruleID] = n
	} else {
		delete(e.ruleWindows, w.ruleID)
	}
}

// allowFinding charges the tenant's findings budget (a token bucket refilled
// at FindingsPerMinute). Resolutions are never charged so a delivered firing
// finding can always be closed.
func (e *Engine) allowFinding(tk tenantKey, nowT time.Time) bool {
	perMin := float64(e.limits.FindingsPerMinute)
	b := e.findingBuckets[tk]
	if b == nil {
		b = &findingBucket{tokens: perMin, last: nowT}
		e.findingBuckets[tk] = b
	}
	if elapsed := nowT.Sub(b.last).Seconds(); elapsed > 0 {
		b.tokens += elapsed * perMin / 60
		if b.tokens > perMin {
			b.tokens = perMin
		}
	}
	b.last = nowT
	if b.tokens < 1 {
		e.limited++
		return false
	}
	b.tokens--
	return true
}

// Tick prunes windows and evaluates every window rule.
func (e *Engine) Tick() {
	e.mu.Lock()
	defer e.flush()
	nowT := e.now()
	for key, w := range e.windows {
		r, ok := e.rules[w.ruleID]
		if !ok {
			e.dropWindow(key, w)
			continue
		}
		cutoff := nowT.Add(-time.Duration(r.WindowSec) * time.Second).UnixMilli()
		i := 0
		for i < len(w.samples) && w.samples[i].AtUnixMs < cutoff {
			i++
		}
		w.samples = w.samples[i:]
		n := len(w.samples)
		value := rules.Compute(r.Metric, w.samples)
		breach := n >= r.MinSamples && n > 0 && rules.Compare(r.Operator, value, r.Threshold)
		switch {
		case breach && !w.firing:
			if !w.lastFired.IsZero() && nowT.Sub(w.lastFired) < time.Duration(r.Cooldown())*time.Second {
				continue
			}
			// Over budget: stay not-firing so the next tick retries.
			if !e.allowFinding(w.tenant, nowT) {
				continue
			}
			w.firing = true
			w.lastFired = nowT
			e.emit(e.windowFinding(r, w, key, StateFiring, value, n, nowT))
		case !breach && w.firing:
			w.firing = false
			e.emit(e.windowFinding(r, w, key, StateResolved, value, n, nowT))
		}
		if n == 0 && !w.firing && (w.lastFired.IsZero() || nowT.Sub(w.lastFired) > time.Duration(r.Cooldown())*time.Second) {
			e.dropWindow(key, w)
			continue
		}
		// Idle windows (no sample for twice the window) are evicted even
		// inside the cooldown so abandoned group values free their budget.
		if !w.firing && nowT.Sub(w.lastSample) > 2*time.Duration(r.WindowSec)*time.Second {
			e.dropWindow(key, w)
		}
	}
	for key, last := range e.instantLast {
		if nowT.Sub(last) > 24*time.Hour {
			delete(e.instantLast, key)
		}
	}
	perMin := float64(e.limits.FindingsPerMinute)
	for tk, b := range e.findingBuckets {
		if b.tokens+nowT.Sub(b.last).Seconds()*perMin/60 >= perMin {
			delete(e.findingBuckets, tk)
		}
	}
}

func (e *Engine) windowFinding(r rules.Rule, w *window, key, state string, value float64, n int, at time.Time) Finding {
	return Finding{
		RuleID: r.ID, RuleName: r.Name, Kind: r.Kind, Mode: r.Mode, Severity: r.Severity,
		State:          state,
		OrganisationID: w.tenant.org, ProjectID: w.tenant.project, Environment: w.tenant.env,
		Group: w.group, Metric: r.Metric, Operator: r.Operator,
		Value: value, Threshold: r.Threshold, WindowSec: r.WindowSec, SampleCount: n,
		DedupeKey: dedupeKey(key), ObservedAt: at.UTC(), Sample: w.last,
	}
}

// emit queues a finding; flush hands it to the sink after e.mu is released
// so a slow sink can never stall evaluation. Caller holds e.mu.
func (e *Engine) emit(f Finding) {
	e.emitted++
	e.pending = append(e.pending, f)
}

// flush releases e.mu and delivers queued findings in order.
func (e *Engine) flush() {
	out := e.pending
	e.pending = nil
	sink := e.sink
	e.mu.Unlock()
	if sink == nil {
		return
	}
	for _, f := range out {
		sink.Emit(f)
	}
}

type Stats struct {
	Rules          int    `json:"rules"`
	Windows        int    `json:"windows"`
	Tenants        int    `json:"tenants"`
	Observed       uint64 `json:"observed"`
	Emitted        uint64 `json:"emitted"`
	Invalid        uint64 `json:"invalid"`
	DroppedWindows uint64 `json:"dropped_windows"`
	RateLimited    uint64 `json:"rate_limited"`
}

func (e *Engine) Stats() Stats {
	e.mu.Lock()
	defer e.mu.Unlock()
	return Stats{
		Rules: len(e.rules), Windows: len(e.windows), Tenants: len(e.tenantWindows),
		Observed: e.observed, Emitted: e.emitted, Invalid: e.invalid,
		DroppedWindows: e.droppedWindows, RateLimited: e.limited,
	}
}

func windowKey(ruleID string, tk tenantKey, group map[string]string) string {
	return strings.Join([]string{ruleID, tk.org, tk.project, tk.env, rules.GroupKey(group)}, "\x1f")
}

func dedupeKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:16])
}
