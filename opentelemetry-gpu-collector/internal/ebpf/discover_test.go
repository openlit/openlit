//go:build linux && (amd64 || arm64)

package ebpf

import (
	"testing"
	"time"
)

func TestParseMapsLibLine(t *testing.T) {
	tests := []struct {
		line     string
		wantAddr string
		wantPath string
		wantOK   bool
	}{
		{
			line:     "7f8a2c000000-7f8a2c200000 r-xp 00000000 08:01 12345 /usr/local/cuda-11.8/targets/x86_64-linux/lib/libcudart.so.11.0",
			wantAddr: "7f8a2c000000-7f8a2c200000",
			wantPath: "/usr/local/cuda-11.8/targets/x86_64-linux/lib/libcudart.so.11.0",
			wantOK:   true,
		},
		{
			line:     "7f8a2c000000-7f8a2c200000 r-xp 00000000 08:01 12345 /usr/local/cuda/lib64/libcudart.so.11.0 (deleted)",
			wantAddr: "7f8a2c000000-7f8a2c200000",
			wantPath: "/usr/local/cuda/lib64/libcudart.so.11.0",
			wantOK:   true,
		},
		{
			line:   "7f8a2c000000-7f8a2c200000 r--p 00000000 08:01 12345 /usr/local/cuda/lib64/libcudart.so",
			wantOK: false, // not executable
		},
		{
			line:   "7f8a2c000000-7f8a2c200000 r-xp 00000000 08:01 12345 [vdso]",
			wantOK: false,
		},
		{
			line:   "incomplete",
			wantOK: false,
		},
	}
	for _, tt := range tests {
		addr, path, ok := parseMapsLibLine(tt.line)
		if ok != tt.wantOK {
			t.Fatalf("parseMapsLibLine(%q) ok=%v want %v", tt.line, ok, tt.wantOK)
		}
		if !tt.wantOK {
			continue
		}
		if addr != tt.wantAddr || path != tt.wantPath {
			t.Fatalf("parseMapsLibLine(%q) = (%q,%q), want (%q,%q)", tt.line, addr, path, tt.wantAddr, tt.wantPath)
		}
	}
}

func TestCudaRescanInterval(t *testing.T) {
	if got := cudaRescanInterval(false); got != 30*time.Second {
		t.Fatalf("waiting interval = %v, want 30s", got)
	}
	if got := cudaRescanInterval(true); got != 5*time.Minute {
		t.Fatalf("attached interval = %v, want 5m", got)
	}
}

func TestIsProcMapFilesPath(t *testing.T) {
	if !isProcMapFilesPath("/proc/1/map_files/7f-8f") {
		t.Fatal("expected map_files path")
	}
	if isProcMapFilesPath("/usr/local/cuda/lib64/libcudart.so") {
		t.Fatal("plain path should not match")
	}
}

func TestIsCudartPath(t *testing.T) {
	yes := []string{
		"/usr/local/cuda-11.8/targets/x86_64-linux/lib/libcudart.so.11.0",
		"/usr/local/cuda/lib64/libcudart.so",
		"/opt/conda/lib/python3.10/site-packages/nvidia/cuda_runtime/lib/libcudart.so.12",
	}
	no := []string{
		"/usr/lib/libcuda.so.1",
		"/usr/local/cuda/lib64/libcudart_static.a",
		"/usr/lib/libamdhip64.so",
		"",
	}
	for _, p := range yes {
		if !isCudartPath(p) {
			t.Errorf("isCudartPath(%q) = false, want true", p)
		}
	}
	for _, p := range no {
		if isCudartPath(p) {
			t.Errorf("isCudartPath(%q) = true, want false", p)
		}
	}
}

func TestIsCudaDriverPath(t *testing.T) {
	yes := []string{
		"/usr/lib/libcuda.so.1",
		"/usr/lib64/libcuda.so",
		"/usr/lib/x86_64-linux-gnu/libcuda.so.550.90.07",
		"/usr/lib/wsl/lib/libcuda.so.1",
	}
	no := []string{
		"/usr/local/cuda/lib64/libcudart.so.12",
		"/usr/lib/libcudart.so",
		"/usr/lib/libamdhip64.so",
	}
	for _, p := range yes {
		if !isCudaDriverPath(p) {
			t.Errorf("isCudaDriverPath(%q) = false, want true", p)
		}
	}
	for _, p := range no {
		if isCudaDriverPath(p) {
			t.Errorf("isCudaDriverPath(%q) = true, want false", p)
		}
	}
}

func TestParseProcPID(t *testing.T) {
	pid, pid32, ok := parseProcPID("1234")
	if !ok || pid != 1234 || pid32 != 1234 {
		t.Fatalf("got pid=%d pid32=%d ok=%v", pid, pid32, ok)
	}
	if _, _, ok := parseProcPID("0"); ok {
		t.Fatal("pid 0 should be rejected")
	}
	if _, _, ok := parseProcPID("self"); ok {
		t.Fatal("non-numeric name should be rejected")
	}
	if _, _, ok := parseProcPID("4294967296"); ok { // 2^32
		t.Fatal("value above uint32 should be rejected")
	}
	if _, _, ok := parseProcPID("2147483648"); ok { // MaxInt32+1
		t.Fatal("value above MaxInt32 should be rejected")
	}
}
