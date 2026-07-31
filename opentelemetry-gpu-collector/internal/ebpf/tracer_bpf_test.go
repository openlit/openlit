//go:build linux && (amd64 || arm64)

package ebpf

import "testing"

func TestGeneratedSpecIncludesCUDA13KernelHandleProbes(t *testing.T) {
	spec, err := loadGpuevent()
	if err != nil {
		t.Fatalf("loadGpuevent() error = %v", err)
	}

	for _, name := range []string{
		"handle_cuda_get_kernel_enter",
		"handle_cuda_get_kernel_exit",
	} {
		if spec.Programs[name] == nil {
			t.Errorf("generated BPF spec is missing program %q", name)
		}
	}

	for _, name := range []string{
		"cuda_get_kernel_cache",
		"cuda_kernel_handles",
	} {
		if spec.Maps[name] == nil {
			t.Errorf("generated BPF spec is missing map %q", name)
		}
	}
}
