package kineto

import (
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
)

// childrenOf returns direct child PIDs of pid. Overridable in tests.
var childrenOf = defaultChildrenOf

// Match intersects registered clients with GPU-active PIDs and optional filters.
//
// When a requested PID is registered but not GPU-active, resolve to registered
// children that appear in gpuPIDs (launcher → worker redirection).
//
// jobID != 0 filters registered clients to that job. Empty wantPIDs matches all
// registered clients that are GPU-active (after job filter).
func Match(registry *Registry, gpuPIDs []int32, wantPIDs []int, jobID int64) (matched []int, resolvedFromLauncher map[int][]int) {
	resolvedFromLauncher = make(map[int][]int)

	gpuSet := make(map[int]struct{}, len(gpuPIDs))
	for _, p := range gpuPIDs {
		gpuSet[int(p)] = struct{}{}
	}

	registered := make(map[int]struct{})
	for _, c := range registry.List() {
		if jobID != 0 && c.JobID != jobID {
			continue
		}
		registered[c.PID] = struct{}{}
	}

	candidates := wantPIDs
	if len(candidates) == 0 {
		candidates = make([]int, 0, len(registered))
		for pid := range registered {
			candidates = append(candidates, pid)
		}
	}

	seen := make(map[int]struct{})
	add := func(pid int) {
		if _, ok := seen[pid]; ok {
			return
		}
		seen[pid] = struct{}{}
		matched = append(matched, pid)
	}

	for _, want := range candidates {
		if _, ok := registered[want]; !ok {
			continue
		}
		if _, ok := gpuSet[want]; ok {
			add(want)
			continue
		}
		// Launcher: registered but not GPU-active — resolve to GPU-active registered children.
		var resolved []int
		for _, child := range childrenOf(want) {
			if _, ok := gpuSet[child]; !ok {
				continue
			}
			if _, ok := registered[child]; !ok {
				continue
			}
			add(child)
			resolved = append(resolved, child)
		}
		if len(resolved) > 0 {
			resolvedFromLauncher[want] = resolved
		}
	}
	return matched, resolvedFromLauncher
}

// CollectGPUPIDs gathers unique process PIDs reported by GPU backends
// (typically NVML compute processes / DRM fdinfo).
func CollectGPUPIDs(devices []gpu.Device) []int32 {
	seen := make(map[int32]struct{})
	var out []int32
	for _, d := range devices {
		if d == nil {
			continue
		}
		procs, err := d.CollectProcesses()
		if err != nil {
			continue
		}
		for _, p := range procs {
			if _, ok := seen[p.PID]; ok {
				continue
			}
			seen[p.PID] = struct{}{}
			out = append(out, p.PID)
		}
	}
	return out
}
