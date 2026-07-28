//go:build linux && (amd64 || arm64)

package ebpf

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// findCudaLibs finds libcudart shared libraries to attach uprobes to.
//
// Discovery order (deduped by inode):
//  1. Filesystem candidates / globs (host install layouts, LD_LIBRARY_PATH, CUDA_HOME)
//  2. /proc/*/maps — fleet-friendly: with host PID visibility (Docker --pid=host /
//     Kubernetes hostPID), finds whatever libcudart GPU workloads actually loaded,
//     including copies only visible inside other containers via /proc/<pid>/map_files
//     or /proc/<pid>/root.
//
// eBPF CUDA probes are NVIDIA/CUDA-only. AMD/Intel process GPU metrics use DRM
// fdinfo/NVML alternatives and do not need libcudart.
func findCudaLibs() []string {
	seenPath := make(map[string]struct{})
	seenInode := make(map[string]struct{})
	var out []string
	add := func(path string) {
		if path == "" {
			return
		}
		fi, err := os.Stat(path)
		if err != nil {
			return
		}
		// Keep /proc/*/map_files/* paths as-is: EvalSymlinks can rewrite them to a
		// container-local pathname that resolves to a *different* host inode.
		resolved := path
		if !isProcMapFilesPath(path) {
			if r, err := filepath.EvalSymlinks(path); err == nil {
				resolved = r
			}
		}
		if _, ok := seenPath[resolved]; ok {
			return
		}
		if sys, ok := fi.Sys().(*syscall.Stat_t); ok {
			key := inodeKey(sys.Dev, sys.Ino)
			if _, ok := seenInode[key]; ok {
				return
			}
			seenInode[key] = struct{}{}
		}
		seenPath[resolved] = struct{}{}
		out = append(out, resolved)
	}

	for _, path := range findCudaLibsFromFS() {
		add(path)
	}
	for _, path := range findCudaLibsFromProc() {
		add(path)
	}
	return out
}

func isProcMapFilesPath(path string) bool {
	// /proc/<pid>/map_files/<start>-<end>
	return strings.HasPrefix(path, "/proc/") && strings.Contains(path, "/map_files/")
}

func inodeKey(dev, ino uint64) string {
	return fmt.Sprintf("%d:%d", dev, ino)
}

func findCudaLibsFromFS() []string {
	var out []string
	add := func(path string) {
		if path == "" {
			return
		}
		if _, err := os.Stat(path); err == nil {
			out = append(out, path)
		}
	}

	candidates := []string{
		"/usr/local/cuda/lib64/libcudart.so",
		"/usr/lib/x86_64-linux-gnu/libcudart.so",
		"/usr/lib/aarch64-linux-gnu/libcudart.so",
		"/usr/lib64/libcudart.so",
		"/usr/lib/libcudart.so",
	}
	if ldPath := os.Getenv("LD_LIBRARY_PATH"); ldPath != "" {
		for _, dir := range strings.Split(ldPath, ":") {
			candidates = append(candidates, filepath.Join(dir, "libcudart.so"))
		}
	}
	if cudaHome := os.Getenv("CUDA_HOME"); cudaHome != "" {
		candidates = append(candidates,
			filepath.Join(cudaHome, "lib64", "libcudart.so"),
			filepath.Join(cudaHome, "lib", "libcudart.so"),
			filepath.Join(cudaHome, "targets", "x86_64-linux", "lib", "libcudart.so"),
			filepath.Join(cudaHome, "targets", "aarch64-linux", "lib", "libcudart.so"),
		)
	}
	for _, path := range candidates {
		add(path)
	}

	globs := []string{
		"/usr/local/cuda*/lib64/libcudart.so*",
		"/usr/local/cuda*/targets/*/lib/libcudart.so*",
		"/usr/lib/x86_64-linux-gnu/libcudart.so*",
		"/usr/lib/aarch64-linux-gnu/libcudart.so*",
		"/usr/local/lib/python*/dist-packages/nvidia/cuda_runtime/lib/libcudart.so*",
		"/usr/lib/python*/site-packages/nvidia/cuda_runtime/lib/libcudart.so*",
		"/opt/conda/lib/libcudart.so*",
		"/opt/conda/lib/python*/site-packages/nvidia/cuda_runtime/lib/libcudart.so*",
	}
	for _, g := range globs {
		matches, _ := filepath.Glob(g)
		for _, m := range matches {
			base := filepath.Base(m)
			// Skip linker scripts / static archives accidentally matched by globs.
			if !strings.Contains(base, ".so") || strings.HasSuffix(base, ".a") {
				continue
			}
			out = append(out, m)
		}
	}
	return out
}

// findCudaLibsFromProc scans host process maps for loaded libcudart copies.
// Keeps cost low: skips kernel threads, and only fully parses map lines that
// mention libcudart (most processes have none).
func findCudaLibsFromProc() []string {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}

	seenInode := make(map[string]struct{})
	var out []string

	for _, ent := range entries {
		if !ent.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(ent.Name())
		if err != nil || pid <= 0 {
			continue
		}
		// Kernel threads have an empty cmdline; skip before opening maps.
		if !isUserspacePID(pid) {
			continue
		}
		for _, path := range cudaLibsForPID(pid) {
			fi, err := os.Stat(path)
			if err != nil {
				continue
			}
			if sys, ok := fi.Sys().(*syscall.Stat_t); ok {
				key := inodeKey(sys.Dev, sys.Ino)
				if _, ok := seenInode[key]; ok {
					continue
				}
				seenInode[key] = struct{}{}
			}
			out = append(out, path)
		}
	}
	return out
}

func isUserspacePID(pid int) bool {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	return err == nil && len(data) > 0
}

func cudaLibsForPID(pid int) []string {
	mapsPath := fmt.Sprintf("/proc/%d/maps", pid)
	f, err := os.Open(mapsPath)
	if err != nil {
		return nil
	}
	defer f.Close()

	var out []string
	seen := make(map[string]struct{})
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 16*1024), 256*1024)
	for scanner.Scan() {
		line := scanner.Text()
		// Cheap reject: almost all map lines are unrelated.
		if !strings.Contains(line, "libcudart") {
			continue
		}
		addrRange, path, ok := parseMapsLibLine(line)
		if !ok || !isCudartPath(path) {
			continue
		}
		resolved := resolveMappedLib(pid, addrRange, path)
		if resolved == "" {
			continue
		}
		if _, ok := seen[resolved]; ok {
			continue
		}
		seen[resolved] = struct{}{}
		out = append(out, resolved)
	}
	return out
}

// parseMapsLibLine extracts the address range and pathname from a /proc/pid/maps line.
func parseMapsLibLine(line string) (addrRange, path string, ok bool) {
	fields := strings.Fields(line)
	if len(fields) < 6 {
		return "", "", false
	}
	// fields[1] permissions — prefer executable mappings for .so attach.
	perms := fields[1]
	if !strings.Contains(perms, "x") {
		return "", "", false
	}
	path = fields[5]
	// Pathnames can contain spaces; join remaining fields. Also strip " (deleted)".
	if len(fields) > 6 {
		path = strings.Join(fields[5:], " ")
	}
	path = strings.TrimSuffix(path, " (deleted)")
	if path == "" || path[0] != '/' {
		return "", "", false
	}
	return fields[0], path, true
}

func isCudartPath(path string) bool {
	base := strings.ToLower(filepath.Base(path))
	return strings.Contains(base, "libcudart.so")
}

// resolveMappedLib opens the library as seen by pid (cross mount-namespace).
// Prefer /proc/<pid>/map_files/<range> itself — that path always refers to the
// inode the process has mapped. Do not EvalSymlinks it to a container pathname
// that may collide with a different host file.
func resolveMappedLib(pid int, addrRange, path string) string {
	mapFile := fmt.Sprintf("/proc/%d/map_files/%s", pid, addrRange)
	if _, err := os.Stat(mapFile); err == nil {
		return mapFile
	}

	rootPath := fmt.Sprintf("/proc/%d/root%s", pid, path)
	if _, err := os.Stat(rootPath); err == nil {
		return rootPath
	}

	// Same mount namespace as the collector (bare metal / host binary).
	if _, err := os.Stat(path); err == nil {
		return path
	}
	return ""
}
