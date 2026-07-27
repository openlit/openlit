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
	logger *slog.Logger
	cfg    *config.Config
	enabled bool

	mu       sync.RWMutex
	cache    map[int32]PodInfo
	negCache map[int32]time.Time // PID → when negative miss was cached
	cacheAt  time.Time
	ttl      time.Duration
	byUID    map[string]PodInfo
	byName   map[string]PodInfo
	byContID map[string]PodInfo
	byPID    map[int32]PodInfo
	byDevice map[string]PodInfo // GPU UUID / device id → pod

	refreshMu sync.Mutex
	stopCh    chan struct{}
	stopped   sync.Once

	podRes *PodResourcesClient
	api    *PodAPIClient

	connectMu       sync.Mutex
	connectAttempt  time.Time
	connectInterval time.Duration
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
		cache:           make(map[int32]PodInfo),
		negCache:        make(map[int32]time.Time),
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
func (e *Enricher) Resolve(pid int32, deviceID string) (PodInfo, bool) {
	if e == nil || !e.enabled || pid <= 0 {
		return PodInfo{}, false
	}

	e.mu.RLock()
	if info, ok := e.cache[pid]; ok {
		e.mu.RUnlock()
		return info, info.PodUID != "" || info.PodName != ""
	}
	if at, ok := e.negCache[pid]; ok && time.Since(at) < e.ttl {
		e.mu.RUnlock()
		return PodInfo{}, false
	}
	byPID := e.byPID[pid]
	byUID := e.byUID
	byCont := e.byContID
	byDev := e.byDevice
	e.mu.RUnlock()

	info := byPID
	if cg, ok := ResolvePod(pid); ok {
		if info.PodUID == "" {
			info.PodUID = cg.PodUID
		}
		if info.ContainerID == "" {
			info.ContainerID = cg.ContainerID
		}
	}
	// Device allocation from PodResources (works without Pod UID).
	if deviceID != "" {
		if p, ok := byDev[deviceID]; ok {
			mergePod(&info, p)
		}
	}
	// Prefer container ID for multi-container pods.
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

	hit := info.PodUID != "" || info.PodName != ""
	e.mu.Lock()
	if hit {
		e.cache[pid] = info
		delete(e.negCache, pid)
	} else {
		e.negCache[pid] = time.Now()
	}
	e.mu.Unlock()
	return info, hit
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
	if indexed {
		e.cache = make(map[int32]PodInfo)
		e.negCache = make(map[int32]time.Time)
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
