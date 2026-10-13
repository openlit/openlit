package workload

import (
	"io"
	"os"
	"strconv"
	"strings"
)

// maxHostnameBytes bounds the read of a container's /etc/hostname (a pod name is ≤ 253 bytes).
const maxHostnameBytes = 4096

// ProcHostname returns the hostname of the process's own mount namespace, read from
// /proc/<pid>/root/etc/hostname. In Kubernetes the kubelet writes the pod name there
// (unless spec.hostname / setHostnameAsFQDN / hostNetwork change it), which lets the
// enricher confirm a kubelet PodResources owner, who carries no pod UID, against the
// process itself. Empty when unreadable (no hostPID, no ptrace access, non-Linux).
func ProcHostname(pid int32) string {
	if pid <= 0 {
		return ""
	}
	return readHostnameFile("/proc/" + strconv.FormatInt(int64(pid), 10) + "/root/etc/hostname")
}

func readHostnameFile(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxHostnameBytes))
	if err != nil {
		return ""
	}
	s := string(data)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

// hostnameMatchesPod reports whether a container hostname names podName: equal, or the
// pod name followed by a domain (setHostnameAsFQDN: <pod>.<subdomain>.<ns>.svc.<cluster>).
func hostnameMatchesPod(hostname, podName string) bool {
	if hostname == "" || podName == "" {
		return false
	}
	return hostname == podName || strings.HasPrefix(hostname, podName+".")
}
