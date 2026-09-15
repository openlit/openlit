// Package drmfdinfo scans DRM client usage stats from /proc/<pid>/fdinfo.
// Spec: https://docs.kernel.org/gpu/drm-usage-stats.html
package drmfdinfo

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/procname"
)

// Client aggregates one DRM client's memory and engine busy counters.
type Client struct {
	PID        int32
	PCIAddress string
	Driver     string
	ClientID   string
	MemoryBy   int64
	// EngineNs maps engine name (e.g. "gfx", "render") to cumulative busy ns.
	EngineNs map[string]uint64
}

// Scanner walks /proc for DRM fdinfo clients and computes utilization deltas.
type Scanner struct {
	mu   sync.Mutex
	prev map[string]engineSample // key: pid|pci|engine

	// clientsCache avoids a full /proc walk per GPU device within one scrape.
	clientsCache   []Client
	clientsCacheAt time.Time
}

type engineSample struct {
	ns   uint64
	wall time.Time
}

// clientsCacheTTL is long enough to cover one metrics callback with multiple
// AMD/Intel devices, short enough that consecutive scrapes still re-scan.
const clientsCacheTTL = time.Second

func NewScanner() *Scanner {
	return &Scanner{prev: make(map[string]engineSample)}
}

func engineKey(pid int32, pci, engine string) string {
	return fmt.Sprintf("%d|%s|%s", pid, strings.ToLower(pci), engine)
}

// CollectForPCI returns ProcessUsage for clients on the given PCI address
// whose drm-driver matches one of allowedDrivers (e.g. "amdgpu", "i915", "xe").
func (s *Scanner) CollectForPCI(pciAddress string, allowedDrivers map[string]bool) ([]gpu.ProcessUsage, error) {
	clients, err := s.cachedClients()
	if err != nil {
		return nil, err
	}

	now := time.Now()
	pciLower := strings.ToLower(pciAddress)

	type agg struct {
		mem     int64
		engines map[string]uint64
	}
	byPID := make(map[int32]*agg)

	for _, c := range clients {
		if !allowedDrivers[c.Driver] {
			continue
		}
		if strings.ToLower(c.PCIAddress) != pciLower {
			continue
		}
		a := byPID[c.PID]
		if a == nil {
			a = &agg{engines: make(map[string]uint64)}
			byPID[c.PID] = a
		}
		a.mem += c.MemoryBy
		for eng, ns := range c.EngineNs {
			a.engines[eng] += ns
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	seenKeys := make(map[string]struct{}, len(byPID)*2)
	out := make([]gpu.ProcessUsage, 0, len(byPID))
	for pid, a := range byPID {
		pu := gpu.ProcessUsage{
			PID:            pid,
			ExecutableName: procname.ExecutableName(pid),
		}
		if a.mem > 0 {
			mem := a.mem
			pu.MemoryBytes = &mem
		}

		primary := pickPrimaryEngine(a.engines)
		if primary != "" {
			key := engineKey(pid, pciLower, primary)
			curr := a.engines[primary]
			if prev, ok := s.prev[key]; ok && curr >= prev.ns {
				wallDelta := now.Sub(prev.wall).Seconds()
				if wallDelta > 0 {
					util := float64(curr-prev.ns) / (wallDelta * 1e9)
					if util > 1 {
						util = 1
					}
					if util < 0 {
						util = 0
					}
					pu.Utilization = &util
				}
			}
		}

		for eng, ns := range a.engines {
			k := engineKey(pid, pciLower, eng)
			s.prev[k] = engineSample{ns: ns, wall: now}
			seenKeys[k] = struct{}{}
		}

		out = append(out, pu)
	}

	// Rebuild prev entries for this PCI so departed clients do not grow forever.
	for k := range s.prev {
		if !strings.Contains(k, "|"+pciLower+"|") {
			continue
		}
		if _, ok := seenKeys[k]; !ok {
			delete(s.prev, k)
		}
	}

	return out, nil
}

func (s *Scanner) cachedClients() ([]Client, error) {
	s.mu.Lock()
	if s.clientsCache != nil && time.Since(s.clientsCacheAt) < clientsCacheTTL {
		c := s.clientsCache
		s.mu.Unlock()
		return c, nil
	}
	s.mu.Unlock()

	clients, err := ScanClients()
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.clientsCache = clients
	s.clientsCacheAt = time.Now()
	s.mu.Unlock()
	return clients, nil
}

func pickPrimaryEngine(engines map[string]uint64) string {
	preferred := []string{"gfx", "graphics", "compute", "render", "rcs"}
	for _, p := range preferred {
		for name := range engines {
			if strings.EqualFold(name, p) || strings.HasPrefix(strings.ToLower(name), p) {
				return name
			}
		}
	}
	// fallback: max busy absolute
	var best string
	var bestNs uint64
	for name, ns := range engines {
		if ns >= bestNs {
			bestNs = ns
			best = name
		}
	}
	return best
}

// ScanClients walks /proc for open DRM fds and parses fdinfo.
func ScanClients() ([]Client, error) {
	procEntries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{}) // pid|client-id|pci
	var out []Client

	for _, pe := range procEntries {
		if !pe.IsDir() {
			continue
		}
		pid64, err := strconv.ParseInt(pe.Name(), 10, 32)
		if err != nil {
			continue
		}
		pid := int32(pid64)
		fdDir := filepath.Join("/proc", pe.Name(), "fd")
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			continue // EACCES / gone
		}
		for _, fd := range fds {
			link, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err != nil {
				continue
			}
			if !strings.HasPrefix(link, "/dev/dri/") {
				continue
			}
			infoPath := filepath.Join("/proc", pe.Name(), "fdinfo", fd.Name())
			c, ok := parseFdinfo(infoPath, pid)
			if !ok {
				continue
			}
			dedup := fmt.Sprintf("%d|%s|%s", pid, c.ClientID, strings.ToLower(c.PCIAddress))
			if c.ClientID != "" {
				if _, exists := seen[dedup]; exists {
					continue
				}
				seen[dedup] = struct{}{}
			}
			out = append(out, c)
		}
	}
	return out, nil
}

func parseFdinfo(path string, pid int32) (Client, bool) {
	f, err := os.Open(path)
	if err != nil {
		return Client{}, false
	}
	defer f.Close()

	c := Client{
		PID:      pid,
		EngineNs: make(map[string]uint64),
	}
	hasDRM := false
	var memCandidates []memCandidate
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		switch {
		case key == "drm-driver":
			c.Driver = val
			hasDRM = true
		case key == "drm-pdev":
			c.PCIAddress = val
			hasDRM = true
		case key == "drm-client-id":
			c.ClientID = val
		case strings.HasPrefix(key, "drm-engine-"):
			name := strings.TrimPrefix(key, "drm-engine-")
			ns, err := parseBusyNs(val)
			if err == nil {
				c.EngineNs[name] = ns
				hasDRM = true
			}
		default:
			if rank, ok := memoryKeyRank(key); ok {
				if b, ok := parseMemBytes(val); ok {
					memCandidates = append(memCandidates, memCandidate{rank: rank, bytes: b})
					hasDRM = true
				}
			}
		}
	}
	if !hasDRM || c.PCIAddress == "" {
		return Client{}, false
	}
	c.MemoryBy = pickMemoryBytes(memCandidates)
	return c, true
}

type memCandidate struct {
	rank  int
	bytes int64
}

// memoryKeyRank prefers a single non-overlapping memory key so we do not
// double-count vram + resident + total from the same client.
// Lower rank wins. Unknown overlapping keys are ignored.
func memoryKeyRank(key string) (int, bool) {
	k := strings.ToLower(key)
	switch {
	case k == "drm-total-memory" || strings.HasSuffix(k, "-total-memory"):
		return 1, true
	case strings.Contains(k, "memory-vram") && !strings.Contains(k, "resident"):
		return 2, true
	case k == "drm-memory-vram":
		return 2, true
	case strings.Contains(k, "resident-vram") || k == "drm-resident-memory":
		return 3, true
	case strings.HasPrefix(k, "drm-memory-") && !strings.Contains(k, "shared"):
		return 4, true
	default:
		return 0, false
	}
}

func pickMemoryBytes(cands []memCandidate) int64 {
	if len(cands) == 0 {
		return 0
	}
	bestRank := cands[0].rank
	var sum int64
	for _, c := range cands {
		if c.rank < bestRank {
			bestRank = c.rank
		}
	}
	for _, c := range cands {
		if c.rank == bestRank {
			sum += c.bytes
		}
	}
	return sum
}

// parseBusyNs accepts "123 ns" or bare integer nanoseconds.
func parseBusyNs(val string) (uint64, error) {
	val = strings.TrimSpace(val)
	val = strings.TrimSuffix(val, "ns")
	val = strings.TrimSpace(val)
	return strconv.ParseUint(val, 10, 64)
}

// parseMemBytes accepts "123 KiB", "4 MiB", or bare bytes.
func parseMemBytes(val string) (int64, bool) {
	fields := strings.Fields(val)
	if len(fields) == 0 {
		return 0, false
	}
	n, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, false
	}
	mult := float64(1)
	if len(fields) > 1 {
		switch strings.ToLower(fields[1]) {
		case "kib":
			mult = 1024
		case "mib":
			mult = 1024 * 1024
		case "gib":
			mult = 1024 * 1024 * 1024
		case "b", "bytes":
			mult = 1
		}
	}
	return int64(n * mult), true
}

// BuildPCIMap maps lowercase PCI addresses from DRM card/render sysfs nodes.
func BuildPCIMap() map[string]string {
	out := make(map[string]string)
	entries, err := os.ReadDir("/sys/class/drm")
	if err != nil {
		return out
	}
	for _, e := range entries {
		name := e.Name()
		if !(strings.HasPrefix(name, "card") || strings.HasPrefix(name, "render")) {
			continue
		}
		if strings.Contains(name, "-") {
			continue
		}
		devPath := filepath.Join("/sys/class/drm", name, "device")
		uevent, err := os.ReadFile(filepath.Join(devPath, "uevent"))
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(uevent), "\n") {
			if strings.HasPrefix(line, "PCI_SLOT_NAME=") {
				pci := strings.TrimPrefix(line, "PCI_SLOT_NAME=")
				out[strings.ToLower(pci)] = pci
			}
		}
	}
	return out
}
