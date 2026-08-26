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
		"handle_cu_launch_kernel",
		"handle_cu_launch_kernel_exit",
		"handle_cu_launch_kernel_ex",
		"handle_cu_launch_kernel_ex_exit",
		"handle_cu_graph_launch",
		"handle_cu_graph_launch_exit",
		"handle_cu_module_get_function_enter",
		"handle_cu_module_get_function_exit",
	} {
		if spec.Programs[name] == nil {
			t.Errorf("generated BPF spec is missing program %q", name)
		}
	}

	for _, name := range []string{
		"cuda_get_kernel_cache",
		"cuda_kernel_handles",
		"cudart_pids",
		"cu_func_names",
	} {
		if spec.Maps[name] == nil {
			t.Errorf("generated BPF spec is missing map %q", name)
		}
	}
}
