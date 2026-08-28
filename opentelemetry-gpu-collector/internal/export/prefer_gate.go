package export

import "sync"

// PreferGate coordinates DCGM Prefer vs vendor (NVML) overlap series.
// Prefer owns overlapping series only after a healthy (non-blank) DCGM sample
// for that GPU; blank Prefer samples re-enable vendor so dashboards stay populated.
type PreferGate struct {
	mu     sync.Mutex
	active bool
	lastOK map[string]bool // hw.id → last Prefer sample healthy
}

// SetActive marks Prefer as owning overlapping series (DCGM metrics running).
func (g *PreferGate) SetActive(v bool) {
	if g == nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.active = v
	if !v {
		g.lastOK = nil
		return
	}
	if g.lastOK == nil {
		g.lastOK = make(map[string]bool)
	}
}

// NoteSample records whether the latest Prefer sample for hwID was usable.
func (g *PreferGate) NoteSample(hwID string, ok bool) {
	if g == nil || hwID == "" {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.active {
		return
	}
	if g.lastOK == nil {
		g.lastOK = make(map[string]bool)
	}
	g.lastOK[hwID] = ok
}

// SuppressVendor reports whether vendor overlap series should be skipped for hwID.
// Only suppresses after a healthy Prefer sample was seen for that GPU — avoids
// empty dashboards at startup or when DCGM returns blank sentinels.
func (g *PreferGate) SuppressVendor(hwID string) bool {
	if g == nil {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.active {
		return false
	}
	ok, seen := g.lastOK[hwID]
	return seen && ok
}
