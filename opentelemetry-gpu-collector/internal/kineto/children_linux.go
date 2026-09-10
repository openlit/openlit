//go:build linux

package kineto

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// defaultChildrenOf lists direct children of pid via /proc/<pid>/task/*/children
// when available, falling back to a PPid scan of /proc.
func defaultChildrenOf(pid int) []int {
	if kids := readTaskChildren(pid); len(kids) > 0 {
		return kids
	}
	return scanProcChildren(pid)
}

func readTaskChildren(pid int) []int {
	pattern := filepath.Join("/proc", strconv.Itoa(pid), "task", "*", "children")
	matches, err := filepath.Glob(pattern)
	if err != nil || len(matches) == 0 {
		return nil
	}
	seen := make(map[int]struct{})
	var out []int
	for _, path := range matches {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, field := range strings.Fields(string(data)) {
			c, err := strconv.Atoi(field)
			if err != nil || c <= 0 {
				continue
			}
			if _, ok := seen[c]; ok {
				continue
			}
			seen[c] = struct{}{}
			out = append(out, c)
		}
	}
	return out
}

func scanProcChildren(pid int) []int {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}
	want := strconv.Itoa(pid)
	var out []int
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		child, err := strconv.Atoi(e.Name())
		if err != nil || child <= 0 {
			continue
		}
		data, err := os.ReadFile(filepath.Join("/proc", e.Name(), "stat"))
		if err != nil {
			continue
		}
		// /proc/<pid>/stat: pid (comm) state ppid ...
		s := string(data)
		rparen := strings.LastIndexByte(s, ')')
		if rparen < 0 || rparen+2 >= len(s) {
			continue
		}
		rest := strings.Fields(s[rparen+2:])
		if len(rest) < 2 {
			continue
		}
		if rest[1] == want {
			out = append(out, child)
		}
	}
	return out
}
