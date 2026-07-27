// Package workload resolves PIDs to Kubernetes pod identity via cgroup paths.
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
}

var (
	// cgroup v1: .../kubepods/.../pod<UID>/...
	// cgroup v2: .../kubepods.slice/kubepods-...-pod<UID>.slice/...
	podUIDRe = regexp.MustCompile(`pod([0-9a-fA-F_-]{8,})`)
	// cri-containerd / docker container id (64 hex) often appears after pod UID
	containerIDRe = regexp.MustCompile(`(?:cri-containerd-|docker-|crio-)([0-9a-f]{64})`)
)

// ResolvePod reads /proc/<pid>/cgroup and extracts pod UID when present.
// Pod name/namespace require an optional lookup; without it only UID is set
// (exported as k8s.pod.uid-compatible attribute by callers that map further).
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
		// format: hierarchy-ID:controller-list:cgroup-path
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
			// Container name is not in cgroup; leave empty. Callers may enrich.
			_ = m
		}
		// Best-effort: systemd style kubepods-<qos>-pod<uid>.slice
		if info.PodName == "" {
			if name, ns := parsePodNameFromPath(path); name != "" {
				info.PodName = name
				info.Namespace = ns
			}
		}
	}
	if info.PodUID == "" && info.PodName == "" {
		return PodInfo{}, false
	}
	return info, true
}

// parsePodNameFromPath looks for /.../<namespace>/<podname>/... patterns used by
// some runtimes; often absent — returns empty.
func parsePodNameFromPath(path string) (name, namespace string) {
	// Downward API / annotated paths are not standard in cgroup; keep minimal.
	_ = path
	return "", ""
}

// Resolver caches ResolvePod results for a scrape cycle.
type Resolver struct {
	cache map[int32]PodInfo
}

func NewResolver() *Resolver {
	return &Resolver{cache: make(map[int32]PodInfo)}
}

func (r *Resolver) Resolve(pid int32) (PodInfo, bool) {
	if info, ok := r.cache[pid]; ok {
		return info, info.PodUID != "" || info.PodName != ""
	}
	info, ok := ResolvePod(pid)
	if ok {
		r.cache[pid] = info
	} else {
		r.cache[pid] = PodInfo{}
	}
	return info, ok
}
