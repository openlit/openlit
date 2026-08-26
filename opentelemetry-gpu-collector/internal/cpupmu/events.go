package cpupmu

import "strings"

// resolveEvents maps config PMUEvents names to hardware event specs and whether
// uncore/IMC memory bandwidth should be opened.
func resolveEvents(names []string) (core []EventSpec, wantUncore bool) {
	if len(names) == 0 {
		names = []string{"instructions", "cycles"}
	}
	seen := make(map[string]bool)
	for _, raw := range names {
		n := strings.ToLower(strings.TrimSpace(raw))
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		switch {
		case n == "instructions" || n == "hw.cpu.instructions":
			core = append(core, EventSpec{Name: "instructions"})
		case n == "cycles" || n == "cpu_cycles" || n == "hw.cpu.cycles":
			core = append(core, EventSpec{Name: "cycles"})
		case strings.Contains(n, "memory_bandwidth") || n == "uncore" || strings.Contains(n, "memory.bandwidth") || n == "memory.io":
			wantUncore = true
		case strings.Contains(n, "cache"):
			core = append(core, cacheSpecsFor(n)...)
		case strings.Contains(n, "tlb"):
			core = append(core, tlbSpecsFor(n)...)
		case strings.Contains(n, "branch"):
			core = append(core, branchSpecsFor(n)...)
		}
	}
	return core, wantUncore
}

func cacheSpecsFor(n string) []EventSpec {
	level := "ll"
	op := "access"
	switch {
	case strings.Contains(n, "l1i"):
		level = "l1i"
	case strings.Contains(n, "l1d") || strings.Contains(n, "l1"):
		level = "l1d"
	case strings.Contains(n, "l2"):
		level = "l2"
	case strings.Contains(n, "l3") || strings.Contains(n, "ll"):
		level = "ll"
	}
	if strings.Contains(n, "miss") {
		op = "miss"
	}
	if n == "cache" || n == "cache_events" {
		return []EventSpec{
			{Name: "cache", Attrs: map[string]string{"hw.cpu.cache.level": "l1d", "hw.cpu.cache.op": "access"}},
			{Name: "cache", Attrs: map[string]string{"hw.cpu.cache.level": "l1d", "hw.cpu.cache.op": "miss"}},
			{Name: "cache", Attrs: map[string]string{"hw.cpu.cache.level": "ll", "hw.cpu.cache.op": "access"}},
			{Name: "cache", Attrs: map[string]string{"hw.cpu.cache.level": "ll", "hw.cpu.cache.op": "miss"}},
		}
	}
	return []EventSpec{{Name: "cache", Attrs: map[string]string{
		"hw.cpu.cache.level": level,
		"hw.cpu.cache.op":    op,
	}}}
}

func tlbSpecsFor(n string) []EventSpec {
	level := "dtlb"
	op := "miss"
	if strings.Contains(n, "itlb") {
		level = "itlb"
	}
	if strings.Contains(n, "access") {
		op = "access"
	}
	return []EventSpec{{Name: "tlb", Attrs: map[string]string{
		"hw.cpu.tlb.level": level,
		"hw.cpu.tlb.op":    op,
	}}}
}

func branchSpecsFor(n string) []EventSpec {
	if n == "branch" || n == "branch_events" {
		return []EventSpec{
			{Name: "branch", Attrs: map[string]string{"hw.cpu.branch.result": "retired"}},
			{Name: "branch", Attrs: map[string]string{"hw.cpu.branch.result": "mispredicted"}},
		}
	}
	result := "retired"
	if strings.Contains(n, "miss") || strings.Contains(n, "mispred") {
		result = "mispredicted"
	}
	return []EventSpec{{Name: "branch", Attrs: map[string]string{"hw.cpu.branch.result": result}}}
}
