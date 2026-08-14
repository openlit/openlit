package engine

import (
	"os"
	"path/filepath"
	"testing"
)

func TestContainerIDRegexMatches(t *testing.T) {
	id64 := "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

	tests := []struct {
		name   string
		input  string
		wantID string
	}{
		{
			name:   "docker cgroup v1",
			input:  "12:cpuset:/docker/" + id64,
			wantID: id64,
		},
		{
			name:   "containerd cgroup v1",
			input:  "0::/system.slice/containerd.service/kubepods/pod-uid/cri-containerd-" + id64 + ".scope",
			wantID: id64,
		},
		{
			name:   "cgroup v2 docker",
			input:  "0::/docker/" + id64,
			wantID: id64,
		},
		{
			name:   "no container",
			input:  "0::/user.slice/user-1000.slice/session-1.scope",
			wantID: "",
		},
		{
			name:   "empty",
			input:  "",
			wantID: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := containerIDRegex.FindString(tt.input)
			if got != tt.wantID {
				t.Errorf("containerIDRegex.FindString(%q) = %q, want %q", tt.input, got, tt.wantID)
			}
		})
	}
}

func TestGetContainerIDFromCgroupFile(t *testing.T) {
	id64 := "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

	procRoot := t.TempDir()
	pidDir := filepath.Join(procRoot, "42")
	if err := os.MkdirAll(pidDir, 0755); err != nil {
		t.Fatal(err)
	}

	cgroupContent := "12:cpuset:/docker/" + id64 + "\n"
	if err := os.WriteFile(filepath.Join(pidDir, "cgroup"), []byte(cgroupContent), 0644); err != nil {
		t.Fatal(err)
	}

	got := getContainerID(procRoot, 42)
	if got != id64 {
		t.Errorf("getContainerID = %q, want %q", got, id64)
	}
}

func TestGetContainerIDReturnsEmptyForNonContainer(t *testing.T) {
	procRoot := t.TempDir()
	pidDir := filepath.Join(procRoot, "42")
	if err := os.MkdirAll(pidDir, 0755); err != nil {
		t.Fatal(err)
	}

	cgroupContent := "0::/user.slice/session.scope\n"
	if err := os.WriteFile(filepath.Join(pidDir, "cgroup"), []byte(cgroupContent), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pidDir, "mountinfo"), []byte(""), 0644); err != nil {
		t.Fatal(err)
	}

	got := getContainerID(procRoot, 42)
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestGetContainerIDNoProcEntry(t *testing.T) {
	procRoot := t.TempDir()
	got := getContainerID(procRoot, 99999)
	if got != "" {
		t.Errorf("expected empty for missing pid, got %q", got)
	}
}
