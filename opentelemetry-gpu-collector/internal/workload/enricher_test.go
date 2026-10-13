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
		enabled:         true,
		resolveCgroup:   cgroup,
		resolveHostname: func(int32) string { return "" }, // unreadable unless a test sets it
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

// PodResources only (no pod API): the process has a cgroup pod UID but no name for it,
// and the GPU owner carries no UID. With no hostname to confirm the owner (unreadable),
// or a hostname naming another pod (lmcache on a GPU allocated to gemma: the #1718
// mislabel), the owner's name must not be attached next to a UID that may belong to
// another pod. Identity stays UID-only, on every device.
func TestResolveUnconfirmedDeviceOwnerNotAppliedToCgroupProcess(t *testing.T) {
	for name, hostname := range map[string]string{"unreadable": "", "other pod": "lmcache-server"} {
		t.Run(name, func(t *testing.T) {
			e := newTestEnricher(func(int32) (PodInfo, bool) {
				return PodInfo{PodUID: "uid-lmcache"}, true
			})
			e.resolveHostname = func(int32) string { return hostname }
			owner := func(p PodInfo) PodInfo { p.PodUID = ""; return p } // PodResources carries no UID
			e.byDevice["GPU-3"] = owner(gemma)
			e.byDevice["GPU-0"] = owner(qwen)

			for _, dev := range []string{"GPU-3", "GPU-0", "GPU-3"} {
				got, ok := e.Resolve(9, dev)
				if !ok || got.PodUID != "uid-lmcache" {
					t.Fatalf("%s: expected cgroup uid, got %+v ok=%v", dev, got, ok)
				}
				if got.PodName != "" || got.Namespace != "" || got.ContainerName != "" {
					t.Fatalf("%s: borrowed unconfirmed owner labels: %+v", dev, got)
				}
			}
		})
	}
}

// PodResources only, common case: a pod's own process on the GPU allocated to it. The
// owner carries no UID, but the container hostname is the pod name, which confirms it.
// The confirmed identity is the process's own: cached per pid, hostname read once, and
// kept on a GPU allocated to another pod.
func TestResolveDeviceOwnerConfirmedByHostname(t *testing.T) {
	for name, hostname := range map[string]string{
		"pod name": "gemma-worker-0",
		"fqdn":     "gemma-worker-0.gemma.llms.svc.cluster.local",
	} {
		t.Run(name, func(t *testing.T) {
			reads := 0
			e := newTestEnricher(func(int32) (PodInfo, bool) {
				return PodInfo{PodUID: "uid-gemma", ContainerID: "cid-gemma"}, true
			})
			e.resolveHostname = func(int32) string { reads++; return hostname }
			owner := func(p PodInfo) PodInfo { p.PodUID = ""; return p }
			e.byDevice["GPU-3"] = owner(gemma)
			e.byDevice["GPU-0"] = owner(qwen)

			got, ok := e.Resolve(21, "GPU-3")
			if !ok || got.PodName != "gemma-worker-0" || got.Namespace != "llms" || got.ContainerName != "main" {
				t.Fatalf("expected hostname-confirmed owner, got %+v", got)
			}
			if got.PodUID != "uid-gemma" || got.ContainerID != "cid-gemma" {
				t.Fatalf("cgroup identity lost: %+v", got)
			}
			got, _ = e.Resolve(21, "GPU-0")
			if got.PodName != "gemma-worker-0" {
				t.Fatalf("confirmed identity must follow the process to other GPUs, got %+v", got)
			}
			if reads != 1 {
				t.Fatalf("hostname should be read once per pid, got %d", reads)
			}
		})
	}
}

// Confirmation searches every allocation. The GPU passed to Resolve is often a device
// this process does not own, and the metrics callback emits that device first.
func TestResolveHostnameConfirmIgnoresScrapeOrder(t *testing.T) {
	reads := 0
	e := newTestEnricher(func(int32) (PodInfo, bool) {
		return PodInfo{PodUID: "uid-qwen"}, true
	})
	e.resolveHostname = func(int32) string { reads++; return "qwen-worker-0" }
	owner := func(p PodInfo) PodInfo { p.PodUID = ""; return p }
	e.byDevice["GPU-3"] = owner(gemma)
	e.byDevice["GPU-0"] = owner(qwen)

	got, ok := e.Resolve(22, "GPU-9")
	if !ok || got.PodName != "qwen-worker-0" || got.Namespace != "llms-dev" || got.PodUID != "uid-qwen" {
		t.Fatalf("name must be present on a GPU this pod does not own, got %+v ok=%v", got, ok)
	}
	got, _ = e.Resolve(22, "GPU-3")
	if got.PodName != "qwen-worker-0" {
		t.Fatalf("confirmed identity must follow the process, got %+v", got)
	}
	if reads != 1 {
		t.Fatalf("hostname should be read once per pid, got %d", reads)
	}
}

// Same pod name in two namespaces is not proof. Leave the process UID-only.
func TestResolveAmbiguousHostnameStaysUIDOnly(t *testing.T) {
	e := newTestEnricher(func(int32) (PodInfo, bool) {
		return PodInfo{PodUID: "uid-worker"}, true
	})
	e.resolveHostname = func(int32) string { return "worker" }
	owner := func(ns string) PodInfo {
		return PodInfo{PodName: "worker", Namespace: ns, ContainerName: "main"}
	}
	e.byDevice["GPU-0"] = owner("a")
	e.byDevice["GPU-1"] = owner("b")

	for _, dev := range []string{"GPU-0", "GPU-1"} {
		got, ok := e.Resolve(24, dev)
		if !ok || got.PodUID != "uid-worker" || got.PodName != "" || got.Namespace != "" {
			t.Fatalf("%s: ambiguous hostname must stay uid-only, got %+v", dev, got)
		}
	}
}

// setHostnameAsFQDN includes the namespace, so the other same-named pod is not a candidate.
func TestResolveFQDNHostnameSelectsNamespace(t *testing.T) {
	e := newTestEnricher(func(int32) (PodInfo, bool) {
		return PodInfo{PodUID: "uid-gemma"}, true
	})
	e.resolveHostname = func(int32) string { return "gemma-worker-0.gemma.llms.svc.cluster.local" }
	strip := func(p PodInfo, ns string) PodInfo {
		p.PodUID = ""
		p.Namespace = ns
		return p
	}
	e.byDevice["GPU-3"] = strip(gemma, "other")
	e.byDevice["GPU-0"] = strip(gemma, "llms")

	got, ok := e.Resolve(25, "GPU-3")
	if !ok || got.PodName != "gemma-worker-0" || got.Namespace != "llms" || got.ContainerName != "main" {
		t.Fatalf("expected the namespace named by the FQDN, got %+v ok=%v", got, ok)
	}
}

// Two containers of the confirmed pod must not contribute an arbitrary container name.
func TestResolveConfirmedPodDropsDisagreeingContainerName(t *testing.T) {
	e := newTestEnricher(func(int32) (PodInfo, bool) {
		return PodInfo{PodUID: "uid-gemma"}, true
	})
	e.resolveHostname = func(int32) string { return "gemma-worker-0" }
	e.byDevice["GPU-0"] = PodInfo{PodName: "gemma-worker-0", Namespace: "llms", ContainerName: "main"}
	e.byDevice["GPU-1"] = PodInfo{PodName: "gemma-worker-0", Namespace: "llms", ContainerName: "sidecar"}

	got, ok := e.Resolve(26, "GPU-1")
	if !ok || got.PodName != "gemma-worker-0" || got.Namespace != "llms" || got.ContainerName != "" {
		t.Fatalf("expected pod without a guessed container, got %+v ok=%v", got, ok)
	}
}

// Hostname confirmation is only for processes with a cgroup pod UID: a host process
// (node hostname) keeps the per-device owner fallback.
func TestResolveHostProcessIgnoresHostname(t *testing.T) {
	reads := 0
	e := newTestEnricher(func(int32) (PodInfo, bool) { return PodInfo{}, false })
	e.resolveHostname = func(int32) string { reads++; return "gpu-node-7" }
	e.byDevice["GPU-3"] = gemma

	got, ok := e.Resolve(23, "GPU-3")
	if !ok || got.PodName != "gemma-worker-0" {
		t.Fatalf("host process should still fall back to the GPU owner, got %+v", got)
	}
	if reads != 0 {
		t.Fatalf("host process must not read a container hostname, got %d reads", reads)
	}
}

// The GPU owner is applied to a process with a cgroup pod UID only when the owner's UID
// confirms it is the same pod.
func TestResolveDeviceOwnerConfirmedByUID(t *testing.T) {
	reads := 0
	e := newTestEnricher(func(int32) (PodInfo, bool) {
		return PodInfo{PodUID: "uid-gemma"}, true
	})
	e.resolveHostname = func(int32) string { reads++; return "gemma-worker-0" }
	e.byDevice["GPU-3"] = gemma

	got, ok := e.Resolve(10, "GPU-5")
	if !ok || got.PodName != "gemma-worker-0" || got.Namespace != "llms" || got.PodUID != "uid-gemma" {
		t.Fatalf("expected confirmed owner, got %+v", got)
	}
	if reads != 0 {
		t.Fatalf("a UID match must not read the container hostname, got %d", reads)
	}
}

// A process without pod identity of its own (host process) falls back to the GPU owner,
// but that is a guess per device: seen on two GPUs it is not pinned to the owner of the
// first one.
func TestResolveDeviceOwnerFallbackIsPerDevice(t *testing.T) {
	e := newTestEnricher(func(int32) (PodInfo, bool) { return PodInfo{}, false })
	e.byDevice["GPU-3"] = gemma
	e.byDevice["GPU-0"] = qwen

	got, ok := e.Resolve(9, "GPU-3")
	if !ok || got.PodName != "gemma-worker-0" || got.Namespace != "llms" {
		t.Fatalf("expected device-owner fallback, got %+v", got)
	}
	got, _ = e.Resolve(9, "GPU-0")
	if got.PodName != "qwen-worker-0" || got.Namespace != "llms-dev" {
		t.Fatalf("fallback must be per device, got %+v", got)
	}
	got, _ = e.Resolve(9, "GPU-3")
	if got.PodName != "gemma-worker-0" {
		t.Fatalf("per-device fallback not reproducible, got %+v", got)
	}
}

// A miss on a GPU without an owner must not be cached per PID: the same process on a
// GPU that has an owner still reaches the fallback.
func TestResolveMissOnOneDeviceDoesNotHideOwnerOnAnother(t *testing.T) {
	e := newTestEnricher(func(int32) (PodInfo, bool) { return PodInfo{}, false })
	e.byDevice["GPU-3"] = gemma

	if got, ok := e.Resolve(13, "GPU-5"); ok {
		t.Fatalf("no owner for GPU-5: expected miss, got %+v", got)
	}
	got, ok := e.Resolve(13, "GPU-3")
	if !ok || got.PodName != "gemma-worker-0" {
		t.Fatalf("negative cache leaked across devices, got %+v ok=%v", got, ok)
	}
	if got, ok := e.Resolve(13, "GPU-5"); ok {
		t.Fatalf("GPU-5 still has no owner: expected miss, got %+v", got)
	}
}

// A UID-only result cached for a device that had no confirming owner must not stick
// to the pid. A later device whose owner confirms the UID still supplies the name,
// including on the device that was cached first.
func TestResolvePartialIdentityDoesNotHideOwnerOnAnotherDevice(t *testing.T) {
	e := newTestEnricher(func(int32) (PodInfo, bool) {
		return PodInfo{PodUID: "uid-gemma"}, true
	})

	got, ok := e.Resolve(14, "GPU-5")
	if !ok || got.PodUID != "uid-gemma" || got.PodName != "" {
		t.Fatalf("expected uid-only partial on GPU-5, got %+v ok=%v", got, ok)
	}
	e.byDevice["GPU-3"] = gemma
	got, ok = e.Resolve(14, "GPU-3")
	if !ok || got.PodName != "gemma-worker-0" {
		t.Fatalf("partial identity cached per pid hid the owner, got %+v", got)
	}
	got, _ = e.Resolve(14, "GPU-5")
	if got.PodName != "gemma-worker-0" {
		t.Fatalf("confirmed identity must replace the earlier uid-only series, got %+v", got)
	}
}

// Identity resolved from the process itself is cached once and reused on every device.
func TestResolveOwnIdentityCachedAcrossDevices(t *testing.T) {
	calls := 0
	e := newTestEnricher(func(int32) (PodInfo, bool) {
		calls++
		return PodInfo{PodUID: "uid-lmcache"}, true
	})
	e.byUID["uid-lmcache"] = lmcache
	e.byDevice["GPU-3"] = gemma

	for _, dev := range []string{"GPU-3", "GPU-0", "GPU-1"} {
		got, _ := e.Resolve(15, dev)
		if got.PodName != "lmcache-server" {
			t.Fatalf("%s: expected own pod, got %+v", dev, got)
		}
	}
	if calls != 1 {
		t.Fatalf("own identity should be resolved once per pid, cgroup read %d times", calls)
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
