package workload

import (
	"context"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
)

// Enricher resolves PID → pod identity using cgroup + optional PodResources + API.
// Outside Kubernetes (or when both enrichment flags are off) Resolve is a free no-op.
type Enricher struct {
	logger  *slog.Logger
	cfg     *config.Config
	enabled bool

	// resolveCgroup reads the process's own pod UID / container id (ResolvePod); injectable for tests.
	resolveCgroup func(pid int32) (PodInfo, bool)
	// resolveHostname reads the process's own /etc/hostname (ProcHostname); injectable for tests.
	resolveHostname func(pid int32) string

	mu  sync.RWMutex
	own map[int32]PodInfo // PID → identity from the process itself; valid on every device
	// cache / negCache hold device-dependent results (GPU-owner fallback, partial
	// identities, misses), keyed per (pid, device).
	cache     map[cacheKey]PodInfo
	negCache  map[cacheKey]time.Time // when the negative miss was cached
	hostnames map[int32]string       // PID → container hostname memo ("" when unreadable)
	cacheAt   time.Time
	ttl       time.Duration
	byUID     map[string]PodInfo
	byName    map[string]PodInfo
	byContID  map[string]PodInfo
	byPID     map[int32]PodInfo
	byDevice  map[string]PodInfo // GPU UUID / device id → pod

	refreshMu sync.Mutex
	stopCh    chan struct{}
	stopped   sync.Once

	podRes *PodResourcesClient
	api    *PodAPIClient

	connectMu       sync.Mutex
	connectAttempt  time.Time
	connectInterval time.Duration
}

// cacheKey scopes a resolution that depended on the GPU it was asked for: a process can
// hold contexts on GPUs allocated to other pods, so whether the PodResources owner of a
// GPU applies (or whether there is one at all) differs per device.
type cacheKey struct {
	pid      int32
	deviceID string
}

// NewEnricher builds a workload enricher. Safe on non-K8s (no-op enrichment).
func NewEnricher(cfg *config.Config, logger *slog.Logger) *Enricher {
	if cfg == nil {
		cfg = config.Load()
	}
	inK8s := os.Getenv("KUBERNETES_SERVICE_HOST") != ""
	enabled := inK8s && (cfg.K8sPodResources || cfg.K8sPodLookup)
	e := &Enricher{
		logger:          logger,
		cfg:             cfg,
		enabled:         enabled,
		resolveCgroup:   ResolvePod,
		resolveHostname: ProcHostname,
		own:             make(map[int32]PodInfo),
		cache:           make(map[cacheKey]PodInfo),
		negCache:        make(map[cacheKey]time.Time),
		hostnames:       make(map[int32]string),
		byUID:           make(map[string]PodInfo),
		byName:          make(map[string]PodInfo),
		byContID:        make(map[string]PodInfo),
		byPID:           make(map[int32]PodInfo),
		byDevice:        make(map[string]PodInfo),
		ttl:             15 * time.Second,
		connectInterval: 30 * time.Second,
		stopCh:          make(chan struct{}),
	}
	if !enabled {
		return e
	}
	if cfg.K8sPodLookup {
		if c, err := NewPodAPIClient(logger); err != nil {
			logger.Debug("pod API lookup unavailable", "error", err)
		} else {
			e.api = c
		}
	}
	// Background refresh keeps kubelet/API I/O off the metrics scrape path.
	go e.loop()
	return e
}

func (e *Enricher) loop() {
	// Prime maps promptly without blocking NewEnricher callers.
	e.refreshMaps()
	t := time.NewTicker(e.ttl)
	defer t.Stop()
	for {
		select {
		case <-e.stopCh:
			return
		case <-t.C:
			e.refreshMaps()
		}
	}
}

func (e *Enricher) ensureClients() {
	if e == nil || e.cfg == nil || !e.cfg.K8sPodResources {
		return
	}
	sock := podResourcesSocket()
	if runtimeIsUnix() {
		if _, err := os.Stat(sock); err != nil {
			return
		}
	}

	e.connectMu.Lock()
	defer e.connectMu.Unlock()
	if e.podRes != nil {
		return
	}
	if !e.connectAttempt.IsZero() && time.Since(e.connectAttempt) < e.connectInterval {
		return
	}
	e.connectAttempt = time.Now()
	if c, err := NewPodResourcesClient(e.logger); err != nil {
		e.logger.Debug("podresources unavailable", "error", err)
	} else {
		e.podRes = c
	}
}

// Resolve returns the best-known pod identity for pid.
// deviceID is an optional GPU UUID used to join PodResources device allocations.
//
// Identity comes from the process itself first (cgroup → container id / pod UID →
// kubelet PodResources and pod API maps). The pod that PodResources allocated a GPU
// to is only a fallback when the process has no pod name of its own: a process may
// hold a context on a GPU allocated to a different pod (privileged pods,
// NVIDIA_VISIBLE_DEVICES=all, host processes), and the GPU owner is not that process's
// pod. A host process takes the owner of the device being scraped. A process with a
// cgroup pod UID takes an owner only when that owner is confirmed as the same pod,
// by UID or (PodResources carries no UID) by the process hostname matched against
// every allocation on the node. The metrics callback emits GPUs in index order, so
// confirmation cannot depend on the device passed in. An unconfirmed or ambiguous
// owner leaves the process UID-only. Identity resolved from or confirmed against the
// process itself is cached per pid; device-dependent fallback, partial identity, and
// misses are cached per (pid, device).
func (e *Enricher) Resolve(pid int32, deviceID string) (PodInfo, bool) {
	if e == nil || !e.enabled || pid <= 0 {
		return PodInfo{}, false
	}
	key := cacheKey{pid: pid, deviceID: deviceID}

	e.mu.RLock()
	if info, ok := e.own[pid]; ok {
		e.mu.RUnlock()
		return info, true
	}
	if info, ok := e.cache[key]; ok {
		e.mu.RUnlock()
		return info, true
	}
	if at, ok := e.negCache[key]; ok && time.Since(at) < e.ttl {
		e.mu.RUnlock()
		return PodInfo{}, false
	}
	byPID := e.byPID[pid]
	byUID := e.byUID
	byCont := e.byContID
	byDev := e.byDevice
	e.mu.RUnlock()

	resolveCgroup := e.resolveCgroup
	if resolveCgroup == nil {
		resolveCgroup = ResolvePod
	}
	info := byPID
	if cg, ok := resolveCgroup(pid); ok {
		if info.PodUID == "" {
			info.PodUID = cg.PodUID
		}
		if info.ContainerID == "" {
			info.ContainerID = cg.ContainerID
		}
	}
	// 1. The process's own pod: container id (multi-container pods) then pod UID.
	if info.ContainerID != "" {
		if p, ok := byCont[info.ContainerID]; ok {
			mergePod(&info, p)
		}
	}
	if info.PodName == "" && info.PodUID != "" {
		if p, ok := byUID[info.PodUID]; ok {
			mergePod(&info, p)
		}
	}
	ownIdentity := info.PodName != ""
	// 2. Fallback to a PodResources GPU owner.
	// Host process: the owner of this device only, cached per device.
	// Cgroup UID and no name yet: one confirmation against every allocation.
	// That result is the process's own pod, so the first GPU in a scrape already
	// carries it. The hostname file is read only when some owner has no UID.
	if !ownIdentity && info.PodUID == "" && deviceID != "" {
		if p, ok := byDev[deviceID]; ok {
			mergePod(&info, p)
		}
	} else if !ownIdentity && info.PodUID != "" {
		if p, ok := e.confirmProcessOwner(byDev, info.PodUID, pid); ok {
			mergePod(&info, p)
			ownIdentity = true
		}
	}

	hit := info.PodUID != "" || info.PodName != ""
	e.mu.Lock()
	switch {
	case ownIdentity:
		e.own[pid] = info
	case hit:
		e.cache[key] = info
		delete(e.negCache, key)
	default:
		e.negCache[key] = time.Now()
	}
	e.mu.Unlock()
	return info, hit
}

// confirmProcessOwner reports the single PodResources pod that is this process.
// A UID match wins and does not consult the hostname. Otherwise the process hostname
// is matched against owners that carry no UID. Two different name/namespace pairs
// are ambiguous: a same-named pod in another namespace must not be attached.
func (e *Enricher) confirmProcessOwner(byDev map[string]PodInfo, podUID string, pid int32) (PodInfo, bool) {
	if p, ok, ambiguous := collectOwners(byDev, func(p PodInfo) bool {
		return podUID != "" && p.PodUID != "" && p.PodUID == podUID
	}); ambiguous {
		return PodInfo{}, false
	} else if ok {
		return p, true
	}
	if !ownerNeedsHostname(byDev) {
		return PodInfo{}, false
	}
	hostname := e.hostnameOf(pid)
	p, ok, ambiguous := collectOwners(byDev, func(p PodInfo) bool {
		return p.PodUID == "" && hostnameMatchesPod(hostname, p.PodName, p.Namespace)
	})
	if ambiguous || !ok {
		return PodInfo{}, false
	}
	return p, true
}

// collectOwners returns the one pod wanted by match. A second pod with a different
// name or namespace is ambiguous. Several allocations of the same pod keep the pod
// and drop ContainerName when the containers disagree.
func collectOwners(byDev map[string]PodInfo, match func(PodInfo) bool) (info PodInfo, ok bool, ambiguous bool) {
	for _, p := range byDev {
		if p.PodName == "" || !match(p) {
			continue
		}
		if !ok {
			info, ok = p, true
			continue
		}
		if p.Namespace != info.Namespace || p.PodName != info.PodName {
			return PodInfo{}, false, true
		}
		if p.ContainerName != info.ContainerName {
			info.ContainerName = ""
		}
	}
	return info, ok, false
}

func ownerNeedsHostname(byDev map[string]PodInfo) bool {
	for _, p := range byDev {
		if p.PodUID == "" && p.PodName != "" {
			return true
		}
	}
	return false
}

// hostnameOf returns the process's container hostname, read once per pid per refresh.
func (e *Enricher) hostnameOf(pid int32) string {
	e.mu.RLock()
	h, ok := e.hostnames[pid]
	e.mu.RUnlock()
	if ok {
		return h
	}
	read := e.resolveHostname
	if read == nil {
		read = ProcHostname
	}
	h = read(pid)
	e.mu.Lock()
	if e.hostnames == nil {
		e.hostnames = make(map[int32]string)
	}
	e.hostnames[pid] = h
	e.mu.Unlock()
	return h
}

func mergePod(dst *PodInfo, src PodInfo) {
	if dst.PodUID == "" {
		dst.PodUID = src.PodUID
	}
	if dst.PodName == "" {
		dst.PodName = src.PodName
	}
	if dst.Namespace == "" {
		dst.Namespace = src.Namespace
	}
	if dst.ContainerName == "" {
		dst.ContainerName = src.ContainerName
	}
	if dst.ContainerID == "" {
		dst.ContainerID = src.ContainerID
	}
}

func (e *Enricher) refreshMaps() {
	if e == nil || !e.enabled {
		return
	}
	e.refreshMu.Lock()
	defer e.refreshMu.Unlock()

	e.ensureClients()

	byUID := make(map[string]PodInfo)
	byName := make(map[string]PodInfo)
	byContID := make(map[string]PodInfo)
	byPID := make(map[int32]PodInfo)
	byDevice := make(map[string]PodInfo)
	indexed := false

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	e.connectMu.Lock()
	podRes := e.podRes
	e.connectMu.Unlock()

	if podRes != nil {
		if list, err := podRes.List(ctx); err == nil {
			for _, p := range list {
				if indexPod(byUID, byName, byContID, byPID, byDevice, p) {
					indexed = true
				}
			}
		} else {
			e.logger.Debug("podresources list failed", "error", err)
		}
	}
	if e.api != nil {
		if list, err := e.api.ListNodePods(ctx); err == nil {
			for _, p := range list {
				if indexPod(byUID, byName, byContID, byPID, byDevice, p) {
					indexed = true
				}
			}
		} else {
			e.logger.Debug("pod API list failed", "error", err)
		}
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	e.hostnames = make(map[int32]string) // PIDs may be reused; re-read next cycle
	if indexed {
		e.own = make(map[int32]PodInfo)
		e.cache = make(map[cacheKey]PodInfo)
		e.negCache = make(map[cacheKey]time.Time)
		e.byUID = byUID
		e.byName = byName
		e.byContID = byContID
		e.byPID = byPID
		e.byDevice = byDevice
	}
	e.cacheAt = time.Now()
}

// indexPod updates maps. Returns true if any join key was written.
func indexPod(byUID, byName, byContID map[string]PodInfo, byPID map[int32]PodInfo, byDevice map[string]PodInfo, p PodInfo) bool {
	wrote := false
	if p.PodUID != "" {
		byUID[p.PodUID] = PodInfo{
			PodUID:    p.PodUID,
			PodName:   p.PodName,
			Namespace: p.Namespace,
		}
		key := p.Namespace + "/" + p.PodName
		if key != "/" {
			byName[key] = byUID[p.PodUID]
		}
		wrote = true
	} else if p.PodName != "" && p.Namespace != "" {
		key := p.Namespace + "/" + p.PodName
		byName[key] = PodInfo{PodName: p.PodName, Namespace: p.Namespace, ContainerName: p.ContainerName}
		wrote = true
	}
	if p.ContainerID != "" {
		byContID[p.ContainerID] = p
		wrote = true
	}
	for _, pid := range p.PIDs {
		byPID[pid] = p
		wrote = true
	}
	for _, id := range p.DeviceIDs {
		if id == "" {
			continue
		}
		byDevice[id] = PodInfo{
			PodUID:        p.PodUID,
			PodName:       p.PodName,
			Namespace:     p.Namespace,
			ContainerName: p.ContainerName,
			ContainerID:   p.ContainerID,
		}
		wrote = true
	}
	return wrote
}

// Close releases clients and stops background refresh.
func (e *Enricher) Close() {
	if e == nil {
		return
	}
	e.stopped.Do(func() {
		if e.stopCh != nil {
			close(e.stopCh)
		}
	})
	e.connectMu.Lock()
	podRes := e.podRes
	e.podRes = nil
	e.connectMu.Unlock()
	if podRes != nil {
		podRes.Close()
	}
	if e.api != nil {
		e.api.Close()
		e.api = nil
	}
}

func runtimeIsUnix() bool {
	return os.PathSeparator == '/'
}
