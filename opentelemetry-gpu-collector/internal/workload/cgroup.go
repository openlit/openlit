package workload

import (
	"os"
	"regexp"
	"strconv"
	"strings"
)

// PodInfo is optional Kubernetes attribution for a process.
type PodInfo struct {
	PodUID        string
	PodName       string
	Namespace     string
	ContainerName string
	ContainerID   string
	// DeviceIDs are GPU UUIDs (or vendor device ids) from PodResources allocations.
	DeviceIDs []string
	// PIDs is populated by PodResources when the kubelet exposes container PIDs.
	PIDs []int32
}

var (
	// cgroup v1: .../kubepods/.../pod<UID>/...
	// cgroup v2: .../kubepods.slice/kubepods-...-pod<uid>.slice/...
	podUIDRe = regexp.MustCompile(`pod([0-9a-fA-F_-]{8,})`)
	// cri-containerd / docker / crio container id (64 hex), or bare 64-hex after pod path
	containerIDRe = regexp.MustCompile(`(?:(?:cri-containerd-|docker-|crio-)|(?:pod[0-9a-fA-F_-]+[./]))([0-9a-f]{64})`)
)

// ResolvePod reads /proc/<pid>/cgroup and extracts pod UID / container id when present.
func ResolvePod(pid int32) (PodInfo, bool) {
	if pid <= 0 {
		return PodInfo{}, false
	}
	data, err := os.ReadFile("/proc/" + strconv.FormatInt(int64(pid), 10) + "/cgroup")
	if err != nil {
		return PodInfo{}, false
	}
	return ParseCgroup(string(data))
}

// ParseCgroup extracts pod identity hints from cgroup file contents.
func ParseCgroup(content string) (PodInfo, bool) {
	info := PodInfo{}
	for _, line := range strings.Split(content, "\n") {
		parts := strings.SplitN(line, ":", 3)
		path := line
		if len(parts) == 3 {
			path = parts[2]
		}
		if m := podUIDRe.FindStringSubmatch(path); len(m) > 1 {
			uid := strings.ReplaceAll(m[1], "_", "-")
			info.PodUID = uid
		}
		if m := containerIDRe.FindStringSubmatch(path); len(m) > 1 {
			info.ContainerID = m[1]
		}
	}
	if info.PodUID == "" && info.PodName == "" && info.ContainerID == "" {
		return PodInfo{}, false
	}
	return info, true
}

// Resolver caches ResolvePod results for a scrape cycle (cgroup-only).
type Resolver struct {
	cache map[int32]PodInfo
}

func NewResolver() *Resolver {
	return &Resolver{cache: make(map[int32]PodInfo)}
}

func (r *Resolver) Resolve(pid int32) (PodInfo, bool) {
	if info, ok := r.cache[pid]; ok {
		return info, info.PodUID != "" || info.PodName != "" || info.ContainerID != ""
	}
	info, ok := ResolvePod(pid)
	if ok {
		r.cache[pid] = info
	} else {
		r.cache[pid] = PodInfo{}
	}
	return info, ok
}
