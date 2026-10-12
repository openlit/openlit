package workload

import (
	"testing"
	"time"
)

func TestIndexPodSeparatesContainerFromUID(t *testing.T) {
	byUID := map[string]PodInfo{}
	byName := map[string]PodInfo{}
	byCont := map[string]PodInfo{}
	byPID := map[int32]PodInfo{}
	byDev := map[string]PodInfo{}

	indexPod(byUID, byName, byCont, byPID, byDev, PodInfo{
		PodUID: "uid-1", PodName: "p", Namespace: "ns",
		ContainerName: "sidecar", ContainerID: "aaa",
	})
	indexPod(byUID, byName, byCont, byPID, byDev, PodInfo{
		PodUID: "uid-1", PodName: "p", Namespace: "ns",
		ContainerName: "app", ContainerID: "bbb",
		DeviceIDs: []string{"GPU-1"},
	})

	if byUID["uid-1"].ContainerName != "" || byUID["uid-1"].ContainerID != "" {
		t.Fatalf("byUID should be pod-level only: %+v", byUID["uid-1"])
	}
	if byCont["bbb"].ContainerName != "app" {
		t.Fatalf("byContID lost app container: %+v", byCont["bbb"])
	}
	if byDev["GPU-1"].ContainerName != "app" || byDev["GPU-1"].PodName != "p" {
		t.Fatalf("byDevice missing allocation: %+v", byDev["GPU-1"])
	}
}

func TestIndexPodResourcesNameOnly(t *testing.T) {
	byUID := map[string]PodInfo{}
	byName := map[string]PodInfo{}
	byCont := map[string]PodInfo{}
	byPID := map[int32]PodInfo{}
	byDev := map[string]PodInfo{}

	ok := indexPod(byUID, byName, byCont, byPID, byDev, PodInfo{
		PodName: "vllm", Namespace: "llm", ContainerName: "server",
		DeviceIDs: []string{"GPU-abc"},
	})
	if !ok {
		t.Fatal("expected indexed")
	}
	if byDev["GPU-abc"].PodName != "vllm" || byDev["GPU-abc"].Namespace != "llm" {
		t.Fatalf("device join failed: %+v", byDev["GPU-abc"])
	}
}

func TestMergePodPrefersExistingContainer(t *testing.T) {
	info := PodInfo{ContainerID: "bbb", ContainerName: "app"}
	mergePod(&info, PodInfo{
		PodUID: "uid-1", PodName: "p", Namespace: "ns",
		ContainerName: "sidecar", ContainerID: "aaa",
	})
	if info.ContainerName != "app" || info.ContainerID != "bbb" {
		t.Fatalf("merge overwrote container identity: %+v", info)
	}
	if info.PodName != "p" || info.Namespace != "ns" {
		t.Fatalf("merge missed pod fields: %+v", info)
	}
}

func newTestEnricher(cgroup func(int32) (PodInfo, bool)) *Enricher {
	return &Enricher{
		enabled:       true,
		resolveCgroup: cgroup,
		cache:         make(map[int32]cachedPod),
		negCache:      make(map[int32]time.Time),
		byUID:         make(map[string]PodInfo),
		byName:        make(map[string]PodInfo),
		byContID:      make(map[string]PodInfo),
		byPID:         make(map[int32]PodInfo),
		byDevice:      make(map[string]PodInfo),
		ttl:           15 * time.Second,
	}
}

var (
	gemma   = PodInfo{PodUID: "uid-gemma", PodName: "gemma-worker-0", Namespace: "llms", ContainerName: "main"}
	qwen    = PodInfo{PodUID: "uid-qwen", PodName: "qwen-worker-0", Namespace: "llms-dev", ContainerName: "main"}
	lmcache = PodInfo{PodUID: "uid-lmcache", PodName: "lmcache-server", Namespace: "cache", ContainerName: "main"}
)

// A privileged pod (NVIDIA_VISIBLE_DEVICES=all) holding contexts on every GPU of the
// node must keep its own identity on GPUs allocated to other pods.
func TestResolvePrefersCgroupIdentityOverDeviceOwner(t *testing.T) {
	e := newTestEnricher(func(int32) (PodInfo, bool) {
		return PodInfo{PodUID: "uid-lmcache", ContainerID: "cid-lmcache"}, true
	})
	e.byUID["uid-lmcache"] = lmcache
	e.byDevice["GPU-3"] = gemma
	e.byDevice["GPU-0"] = qwen

	got, ok := e.Resolve(42, "GPU-3")
	if !ok || got.PodName != "lmcache-server" || got.Namespace != "cache" || got.PodUID != "uid-lmcache" {
		t.Fatalf("expected cgroup pod, got %+v", got)
	}
	// Cached per pid: same answer on another GPU owned by another pod.
	got, _ = e.Resolve(42, "GPU-0")
	if got.PodName != "lmcache-server" {
		t.Fatalf("cached identity changed with device: %+v", got)
	}
}

func TestResolveContainerIDBeatsDeviceOwner(t *testing.T) {
	e := newTestEnricher(func(int32) (PodInfo, bool) {
		return PodInfo{PodUID: "uid-qwen", ContainerID: "cid-qwen"}, true
	})
	e.byContID["cid-qwen"] = PodInfo{PodUID: "uid-qwen", PodName: "qwen-worker-0", Namespace: "llms-dev", ContainerName: "main", ContainerID: "cid-qwen"}
	e.byDevice["GPU-3"] = gemma

	got, _ := e.Resolve(7, "GPU-3")
	if got.PodName != "qwen-worker-0" || got.ContainerName != "main" || got.ContainerID != "cid-qwen" {
		t.Fatalf("expected container-id join, got %+v", got)
	}
}

// PodResources only (no pod API): the GPU owner is the best guess, but it is a guess per
// device, so a process seen on two GPUs is not pinned to the owner of the first one.
func TestResolveDeviceOwnerFallbackIsPerDevice(t *testing.T) {
	e := newTestEnricher(func(int32) (PodInfo, bool) {
		return PodInfo{PodUID: "uid-lmcache"}, true
	})
	owner := func(p PodInfo) PodInfo { p.PodUID = ""; return p } // PodResources carries no UID
	e.byDevice["GPU-3"] = owner(gemma)
	e.byDevice["GPU-0"] = owner(qwen)

	got, ok := e.Resolve(9, "GPU-3")
	if !ok || got.PodName != "gemma-worker-0" || got.PodUID != "uid-lmcache" {
		t.Fatalf("expected device-owner fallback with cgroup uid kept, got %+v", got)
	}
	got, _ = e.Resolve(9, "GPU-0")
	if got.PodName != "qwen-worker-0" {
		t.Fatalf("fallback must be per device, got %+v", got)
	}
	got, _ = e.Resolve(9, "GPU-3")
	if got.PodName != "gemma-worker-0" {
		t.Fatalf("per-device fallback not reproducible, got %+v", got)
	}
}

func TestResolveNoDeviceOwnerWhenUIDDiffers(t *testing.T) {
	e := newTestEnricher(func(int32) (PodInfo, bool) {
		return PodInfo{PodUID: "uid-lmcache"}, true
	})
	e.byDevice["GPU-3"] = gemma // owner UID known (pod API) and different

	got, ok := e.Resolve(11, "GPU-3")
	if !ok || got.PodUID != "uid-lmcache" || got.PodName != "" {
		t.Fatalf("must not borrow the owner's name, got %+v", got)
	}
}

func TestResolveHostProcessUsesDeviceOwner(t *testing.T) {
	e := newTestEnricher(func(int32) (PodInfo, bool) { return PodInfo{}, false })
	e.byDevice["GPU-3"] = gemma

	got, ok := e.Resolve(13, "GPU-3")
	if !ok || got.PodName != "gemma-worker-0" {
		t.Fatalf("process without cgroup identity should fall back to the GPU owner, got %+v", got)
	}
	if _, ok := e.Resolve(13, "GPU-5"); ok {
		t.Fatal("no owner for GPU-5: expected miss")
	}
}
