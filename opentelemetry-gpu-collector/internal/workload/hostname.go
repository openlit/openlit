package workload

import (
	"io"
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
	// openHostname refuses symlinks, directories, and FIFOs. A container can
	// replace /etc/hostname with a FIFO; a blocking open here stalls the single
	// metrics callback that walks every GPU.
	f, err := openHostname(path)
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

// hostnameMatchesPod reports whether a container hostname names podName in namespace.
// The kubelet default writes the pod name. setHostnameAsFQDN writes
// <pod>.<subdomain>.<namespace>.svc.<cluster>; a dotted name counts only when
// namespace appears in that position, so pod "api" in namespace dev does not
// confirm hostname "api.web.prod.svc.cluster.local".
func hostnameMatchesPod(hostname, podName, namespace string) bool {
	if hostname == "" || podName == "" {
		return false
	}
	if hostname == podName {
		return true
	}
	if namespace == "" || !strings.HasPrefix(hostname, podName+".") {
		return false
	}
	rest := hostname[len(podName)+1:]
	needle := namespace + ".svc."
	return strings.HasPrefix(rest, needle) || strings.Contains(rest, "."+needle)
}
