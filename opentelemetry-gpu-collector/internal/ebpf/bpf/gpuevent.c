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
//
// dim3 is a 12-byte struct of three uint32 values. The way it is passed in
// registers at the libcudart entry point differs by target architecture, so
// the decoder is split per __TARGET_ARCH_* macro (auto-defined by bpf2go).
//
// `stream` is intentionally not decoded here — it is the 6th argument and on
// both ABIs it spills past the registers covered by libbpf's PT_REGS_PARMn
// macros (x86_64: stack; arm64: x7). Userspace does not consume the field
// today, so we keep the wire layout but zero the value to avoid reading
// arbitrary stack bytes inside the BPF program.
SEC("uprobe/cudaLaunchKernel")
int handle_cuda_launch(struct pt_regs *ctx) {
    struct gpu_kernel_launch_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    ev->flags = EVENT_GPU_KERNEL_LAUNCH;
    ev->pid_info = get_pid_info();
    ev->stream = 0;

    // arg0: const void *func (kernel function pointer)
    ev->kern_func_off = PT_REGS_PARM1(ctx);

#if defined(__TARGET_ARCH_x86)
    // x86_64 System V: dim3 (12 bytes) is decomposed into 3 uint32 fields and
    // packed two-per-register across rsi/rdx/rcx, as observed in libcudart
    // CUDA 11.x–12.x (gcc/clang). With func consuming rdi:
    //   rsi (PARM2): gridDim.x  | gridDim.y
    //   rdx (PARM3): gridDim.z  | blockDim.x
    //   rcx (PARM4): blockDim.y | blockDim.z
    __u64 grid_xy = PT_REGS_PARM2(ctx);
    ev->grid_x = grid_xy & 0xFFFFFFFF;
    ev->grid_y = grid_xy >> 32;
    __u64 grid_z_block_x = PT_REGS_PARM3(ctx);
    ev->grid_z  = grid_z_block_x & 0xFFFFFFFF;
    ev->block_x = grid_z_block_x >> 32;
    __u64 block_yz = PT_REGS_PARM4(ctx);
    ev->block_y = block_yz & 0xFFFFFFFF;
    ev->block_z = block_yz >> 32;
#elif defined(__TARGET_ARCH_arm64)
    // AArch64 AAPCS64 (§6.4.2): each dim3 (12 bytes, rounded to 16) occupies
    // two consecutive 64-bit GPRs and tail padding is NOT merged with the
    // next argument. With func consuming x0:
    //   x1 (PARM2): gridDim.x  | gridDim.y
    //   x2 (PARM3): gridDim.z  | (pad)
    //   x3 (PARM4): blockDim.x | blockDim.y
    //   x4 (PARM5): blockDim.z | (pad)
    __u64 grid_xy = PT_REGS_PARM2(ctx);
    ev->grid_x = grid_xy & 0xFFFFFFFF;
    ev->grid_y = grid_xy >> 32;
    ev->grid_z = PT_REGS_PARM3(ctx) & 0xFFFFFFFF;
    __u64 block_xy = PT_REGS_PARM4(ctx);
    ev->block_x = block_xy & 0xFFFFFFFF;
    ev->block_y = block_xy >> 32;
    ev->block_z = PT_REGS_PARM5(ctx) & 0xFFFFFFFF;
#else
#error "cudaLaunchKernel argument decoding not implemented for this architecture"
#endif

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
