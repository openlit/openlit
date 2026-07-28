//go:build linux && (amd64 || arm64)

package ebpf

import "testing"

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
