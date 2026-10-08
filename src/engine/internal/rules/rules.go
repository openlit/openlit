// Package rules defines the single rule model shared by every realtime use
// case (threshold, cost, compliance, security). Rules are data delivered by
// the OpenLIT server; the engine never decides which tenant may use a rule.
package rules

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/openlit/openlit/engine/internal/signal"
)

const (
	ModeWindow  = "window"
	ModeInstant = "instant"
)

type Scope struct {
	OrganisationID string `json:"organisationId,omitempty"`
	ProjectID      string `json:"projectId,omitempty"`
	Environment    string `json:"environment,omitempty"`
}

type Condition struct {
	Field  string   `json:"field"`
	Op     string   `json:"op"`
	Values []string `json:"values,omitempty"`
}

type Rule struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Kind        string      `json:"kind"`
	Mode        string      `json:"mode"`
	Severity    string      `json:"severity"`
	Scope       Scope       `json:"scope"`
	Match       []Condition `json:"match,omitempty"`
	GroupBy     []string    `json:"groupBy,omitempty"`
	Metric      string      `json:"metric,omitempty"`
	Operator    string      `json:"operator,omitempty"`
	Threshold   float64     `json:"threshold"`
	WindowSec   int         `json:"windowSec,omitempty"`
	MinSamples  int         `json:"minSamples,omitempty"`
	CooldownSec int         `json:"cooldownSec,omitempty"`
}

var validMetrics = map[string]bool{
	"error_rate": true, "error_count": true, "count": true,
	"p95_latency_ms": true, "avg_latency_ms": true,
	"total_tokens": true, "cost": true,
}

func (r Rule) Validate() error {
	if strings.TrimSpace(r.ID) == "" {
		return fmt.Errorf("rule id is required")
	}
	for _, g := range r.GroupBy {
		if !signal.Groupable(g) {
			return fmt.Errorf("rule %s: unknown groupBy field %q", r.ID, g)
		}
	}
	for _, c := range r.Match {
		if !validOp(c.Op) {
			return fmt.Errorf("rule %s: unknown op %q", r.ID, c.Op)
		}
		if !signal.Known(c.Field) {
			return fmt.Errorf("rule %s: unknown match field %q", r.ID, c.Field)
		}
	}
	switch r.Mode {
	case ModeInstant:
		if len(r.Match) == 0 {
			return fmt.Errorf("rule %s: instant rules need match conditions", r.ID)
		}
	case ModeWindow:
		if !validMetrics[r.Metric] {
			return fmt.Errorf("rule %s: unknown metric %q", r.ID, r.Metric)
		}
		if r.WindowSec <= 0 || r.WindowSec > 3600 {
			return fmt.Errorf("rule %s: windowSec must be 1..3600", r.ID)
		}
		if !validOperator(r.Operator) {
			return fmt.Errorf("rule %s: unknown operator %q", r.ID, r.Operator)
		}
	default:
		return fmt.Errorf("rule %s: unknown mode %q", r.ID, r.Mode)
	}
	return nil
}

func (r Rule) Cooldown() int {
	if r.CooldownSec > 0 {
		return r.CooldownSec
	}
	return 600
}

// InScope enforces the rule's tenant scope. Empty scope fields mean the rule
// is a built-in that applies to every tenant.
func (r Rule) InScope(s signal.Signal) bool {
	if r.Scope.OrganisationID != "" && r.Scope.OrganisationID != s.OrganisationID {
		return false
	}
	if r.Scope.ProjectID != "" && r.Scope.ProjectID != s.ProjectID {
		return false
	}
	if r.Scope.Environment != "" && r.Scope.Environment != s.Environment {
		return false
	}
	return true
}

func (r Rule) Matches(s signal.Signal) bool {
	for _, c := range r.Match {
		if !c.matches(s) {
			return false
		}
	}
	return true
}

// GroupValues returns the group-by values; ok is false when a group field is
// empty (e.g. per-model rule on a span with no model).
func (r Rule) GroupValues(s signal.Signal) (map[string]string, bool) {
	out := make(map[string]string, len(r.GroupBy))
	for _, g := range r.GroupBy {
		v, _ := s.Field(g)
		if v == "" {
			return nil, false
		}
		out[g] = v
	}
	return out, true
}

func GroupKey(values map[string]string) string {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+values[k])
	}
	return strings.Join(parts, ",")
}

func validOp(op string) bool {
	switch op {
	case "eq", "neq", "in", "not_in", "exists", "gt", "gte", "lt", "lte", "contains":
		return true
	}
	return false
}

func validOperator(op string) bool {
	switch op {
	case "gt", "gte", "lt", "lte":
		return true
	}
	return false
}

func Compare(op string, value, threshold float64) bool {
	switch op {
	case "gt":
		return value > threshold
	case "gte":
		return value >= threshold
	case "lt":
		return value < threshold
	case "lte":
		return value <= threshold
	}
	return false
}

func (c Condition) matches(s signal.Signal) bool {
	switch c.Op {
	case "gt", "gte", "lt", "lte":
		v, ok := s.Number(c.Field)
		if !ok || len(c.Values) == 0 {
			return false
		}
		t, err := strconv.ParseFloat(c.Values[0], 64)
		if err != nil {
			return false
		}
		return Compare(c.Op, v, t)
	}
	v, ok := s.Field(c.Field)
	if !ok {
		n, isNum := s.Number(c.Field)
		if !isNum {
			return false
		}
		v = strconv.FormatFloat(n, 'f', -1, 64)
	}
	switch c.Op {
	case "exists":
		return v != "" && v != "0"
	case "eq":
		return len(c.Values) > 0 && strings.EqualFold(v, c.Values[0])
	case "neq":
		return len(c.Values) > 0 && !strings.EqualFold(v, c.Values[0])
	case "in":
		return containsFold(c.Values, v)
	case "not_in":
		return v != "" && !containsFold(c.Values, v)
	case "contains":
		return len(c.Values) > 0 && strings.Contains(strings.ToLower(v), strings.ToLower(c.Values[0]))
	}
	return false
}

func containsFold(values []string, v string) bool {
	for _, candidate := range values {
		if strings.EqualFold(candidate, v) {
			return true
		}
	}
	return false
}

// Sample is the per-signal data a window keeps.
type Sample struct {
	AtUnixMs   int64
	DurationMs float64
	Error      bool
	Tokens     float64
	Cost       float64
	HasCost    bool
}

func SampleOf(s signal.Signal, atUnixMs int64) Sample {
	out := Sample{
		AtUnixMs:   atUnixMs,
		DurationMs: s.DurationMs,
		Error:      s.Status == "error",
		Tokens:     float64(s.TotalTokens),
	}
	if s.Cost != nil {
		out.Cost = *s.Cost
		out.HasCost = true
	}
	return out
}

// Compute evaluates a window metric over samples.
func Compute(metric string, samples []Sample) float64 {
	n := len(samples)
	if n == 0 {
		return 0
	}
	switch metric {
	case "count":
		return float64(n)
	case "error_count", "error_rate":
		errs := 0
		for _, s := range samples {
			if s.Error {
				errs++
			}
		}
		if metric == "error_count" {
			return float64(errs)
		}
		return float64(errs) / float64(n)
	case "avg_latency_ms":
		total := 0.0
		for _, s := range samples {
			total += s.DurationMs
		}
		return total / float64(n)
	case "p95_latency_ms":
		durations := make([]float64, n)
		for i, s := range samples {
			durations[i] = s.DurationMs
		}
		sort.Float64s(durations)
		idx := int(math.Ceil(0.95*float64(n))) - 1
		if idx < 0 {
			idx = 0
		}
		return durations[idx]
	case "total_tokens":
		total := 0.0
		for _, s := range samples {
			total += s.Tokens
		}
		return total
	case "cost":
		total := 0.0
		for _, s := range samples {
			if s.HasCost {
				total += s.Cost
			}
		}
		return total
	}
	return 0
}
