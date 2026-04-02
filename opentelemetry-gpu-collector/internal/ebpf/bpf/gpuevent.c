// GPU event eBPF probes for CUDA runtime interception.
// License: Apache-2.0

//go:build ignore

#include "vmlinux.h"
#include "bpf_helpers.h"
#include "bpf_tracing.h"
#include "gpuevent.h"

char LICENSE[] SEC("license") = "Dual MIT/GPL";

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 24); // 16 MB
} gpu_events SEC(".maps");

// Capture settings (toggled via map).
struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key, __u32);
    __type(value, __u32);
} capture_config SEC(".maps");

static __always_inline struct pid_info_t get_pid_info() {
    struct pid_info_t pi = {};
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    pi.host_pid = pid_tgid >> 32;
    pi.user_pid = pid_tgid >> 32;

    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    if (task) {
        struct nsproxy *ns;
        bpf_probe_read_kernel(&ns, sizeof(ns), &task->nsproxy);
        if (ns) {
            struct pid_namespace *pidns;
            bpf_probe_read_kernel(&pidns, sizeof(pidns), &ns->pid_ns_for_children);
            if (pidns) {
                unsigned int level;
                bpf_probe_read_kernel(&level, sizeof(level), &pidns->level);
                pi.ns = level;
            }
        }
    }
    return pi;
}

// uprobe/cudaLaunchKernel intercepts CUDA kernel launches.
// Signature: cudaError_t cudaLaunchKernel(const void *func, dim3 gridDim,
//            dim3 blockDim, void **args, size_t sharedMem, cudaStream_t stream)
SEC("uprobe/cudaLaunchKernel")
int handle_cuda_launch(struct pt_regs *ctx) {
    struct gpu_kernel_launch_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    ev->flags = EVENT_GPU_KERNEL_LAUNCH;
    ev->pid_info = get_pid_info();

    // arg0: const void *func (kernel function pointer)
    ev->kern_func_off = PT_REGS_PARM1(ctx);

    // arg1: dim3 gridDim (passed as struct, 3x uint32)
    // On x86_64 System V ABI, dim3 is passed in rsi (x,y packed) and rdx (z).
    __u64 grid_xy = PT_REGS_PARM2(ctx);
    ev->grid_x = grid_xy & 0xFFFFFFFF;
    ev->grid_y = grid_xy >> 32;
    ev->grid_z = PT_REGS_PARM3(ctx) & 0xFFFFFFFF;

    // arg2: dim3 blockDim
    __u64 block_xy = PT_REGS_PARM3(ctx) >> 32;
    // blockDim is split across registers on x86_64
    ev->block_x = block_xy & 0xFFFFFFFF;
    __u64 parm4 = PT_REGS_PARM4(ctx);
    ev->block_y = parm4 & 0xFFFFFFFF;
    ev->block_z = parm4 >> 32;

    // arg4: cudaStream_t stream (6th parameter)
    ev->stream = PT_REGS_PARM6(ctx);

    // Capture user-space stack trace
    bpf_get_stack(ctx, ev->ustack, sizeof(ev->ustack), BPF_F_USER_STACK);

    bpf_ringbuf_submit(ev, 0);
    return 0;
}

// uprobe/cudaMalloc intercepts GPU memory allocations.
// Signature: cudaError_t cudaMalloc(void **devPtr, size_t size)
SEC("uprobe/cudaMalloc")
int handle_cuda_malloc(struct pt_regs *ctx) {
    struct gpu_malloc_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    ev->flags = EVENT_GPU_MALLOC;
    ev->pid_info = get_pid_info();
    ev->size = PT_REGS_PARM2(ctx);

    bpf_ringbuf_submit(ev, 0);
    return 0;
}

// uprobe/cudaMemcpy intercepts GPU memory copy operations.
// Signature: cudaError_t cudaMemcpyAsync(void *dst, const void *src,
//            size_t count, enum cudaMemcpyKind kind, cudaStream_t stream)
SEC("uprobe/cudaMemcpy")
int handle_cuda_memcpy(struct pt_regs *ctx) {
    struct gpu_memcpy_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    ev->flags = EVENT_GPU_MEMCPY;
    ev->pid_info = get_pid_info();
    ev->size = PT_REGS_PARM3(ctx);
    ev->kind = (__u8)PT_REGS_PARM4(ctx);

    bpf_ringbuf_submit(ev, 0);
    return 0;
}
