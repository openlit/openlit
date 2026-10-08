// Package engine evaluates realtime rules over OpenLIT Signals. Windows are
// keyed by rule + organisation + project + environment + group values, so
// state from one tenant can never influence another tenant's finding.
package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
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

type tenantKey struct {
	org, project, env string
}

type window struct {
	ruleID    string
	tenant    tenantKey
	group     map[string]string
	samples   []rules.Sample
	firing    bool
	lastFired time.Time
	last      SampleRef
}

type Engine struct {
	mu          sync.Mutex
	rules       map[string]rules.Rule
	windows     map[string]*window
	instantLast map[string]time.Time
	sink        Sink
	now         func() time.Time
	maxSamples  int
	recent      []ObservedSignal
	recentCap   int
	observed    uint64
	emitted     uint64
}

func New(sink Sink) *Engine {
	return &Engine{
		rules:       map[string]rules.Rule{},
		windows:     map[string]*window{},
		instantLast: map[string]time.Time{},
		sink:        sink,
		now:         time.Now,
		maxSamples:  20000,
		recentCap:   recentCap,
	}
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
			delete(e.windows, key)
		}
	}
	e.rules = next
	return len(next)
}

func (e *Engine) Observe(s signal.Signal, at time.Time) {
	if s.OrganisationID == "" || s.ProjectID == "" || s.Environment == "" {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.observed++
	e.remember(s, at)
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
			if last, seen := e.instantLast[key]; seen && nowT.Sub(last) < time.Duration(r.Cooldown())*time.Second {
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
			w = &window{ruleID: r.ID, tenant: tk, group: group}
			e.windows[key] = w
		}
		w.samples = append(w.samples, rules.SampleOf(s, at.UnixMilli()))
		if len(w.samples) > e.maxSamples {
			w.samples = w.samples[len(w.samples)-e.maxSamples:]
		}
		w.last = ref
	}
}

// Tick prunes windows and evaluates every window rule.
func (e *Engine) Tick() {
	e.mu.Lock()
	defer e.mu.Unlock()
	nowT := e.now()
	for key, w := range e.windows {
		r, ok := e.rules[w.ruleID]
		if !ok {
			delete(e.windows, key)
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
			w.firing = true
			w.lastFired = nowT
			e.emit(e.windowFinding(r, w, key, StateFiring, value, n, nowT))
		case !breach && w.firing:
			w.firing = false
			e.emit(e.windowFinding(r, w, key, StateResolved, value, n, nowT))
		}
		if n == 0 && !w.firing && (w.lastFired.IsZero() || nowT.Sub(w.lastFired) > time.Duration(r.Cooldown())*time.Second) {
			delete(e.windows, key)
		}
	}
	for key, last := range e.instantLast {
		if nowT.Sub(last) > 24*time.Hour {
			delete(e.instantLast, key)
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

func (e *Engine) emit(f Finding) {
	e.emitted++
	if e.sink != nil {
		e.sink.Emit(f)
	}
}

type Stats struct {
	Rules    int    `json:"rules"`
	Windows  int    `json:"windows"`
	Observed uint64 `json:"observed"`
	Emitted  uint64 `json:"emitted"`
}

func (e *Engine) Stats() Stats {
	e.mu.Lock()
	defer e.mu.Unlock()
	return Stats{Rules: len(e.rules), Windows: len(e.windows), Observed: e.observed, Emitted: e.emitted}
}

func windowKey(ruleID string, tk tenantKey, group map[string]string) string {
	return strings.Join([]string{ruleID, tk.org, tk.project, tk.env, rules.GroupKey(group)}, "\x1f")
}

func dedupeKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:16])
}
