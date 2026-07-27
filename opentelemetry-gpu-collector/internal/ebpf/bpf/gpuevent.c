// GPU event eBPF probes for CUDA runtime interception (stream-sync occupancy).
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

// Entry caches for uretprobes (keyed by pid_tgid).
struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 1024);
    __type(key, __u64);
    __type(value, __u64);
} cuda_sync_cache SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 1024);
    __type(key, __u64);
    __type(value, __s32);
} cuda_set_device_cache SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 1024);
    __type(key, __u64);
    __type(value, __u64);
} cuda_malloc_size_cache SEC(".maps");

static __always_inline void fill_header(struct cuda_event_header_t *hdr, __u8 type, __u64 stream_id) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    hdr->type = type;
    hdr->pad0 = 0;
    hdr->device_idx = DEVICE_IDX_UNKNOWN;
    hdr->pid = pid_tgid >> 32;
    hdr->tid = (__u32)pid_tgid;
    hdr->pad1 = 0;
    hdr->stream_id = stream_id;
    hdr->ktime_ns = bpf_ktime_get_ns();
}

// cudaLaunchKernel(const void *func, dim3 gridDim, dim3 blockDim,
//                  void **args, size_t sharedMem, cudaStream_t stream)
SEC("uprobe/cudaLaunchKernel")
int handle_cuda_launch(struct pt_regs *ctx) {
    struct gpu_kernel_launch_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    __u64 stream = 0;
    __u32 shared = 0;

#if defined(__TARGET_ARCH_x86)
    // After dim3 packing: r8=args, r9=sharedMem, stream on stack at SP+8.
    shared = (__u32)PT_REGS_PARM6(ctx);
    bpf_probe_read_user(&stream, sizeof(stream), (void *)(PT_REGS_SP(ctx) + 8));

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
    // AAPCS64: func=x0, grid=x1/x2, block=x3/x4, args=x5, shared=x6, stream=x7
    {
        struct user_pt_regs *regs = (struct user_pt_regs *)ctx;
        shared = (__u32)regs->regs[6];
        stream = regs->regs[7];
    }

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

    fill_header(&ev->hdr, EVENT_GPU_KERNEL_LAUNCH, stream);
    ev->kern_func_off = PT_REGS_PARM1(ctx);
    ev->shared_mem_bytes = shared;
    ev->pad = 0;

    bpf_ringbuf_submit(ev, 0);
    return 0;
}

SEC("uprobe/cudaMalloc")
int handle_cuda_malloc_enter(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 size = PT_REGS_PARM2(ctx);
    bpf_map_update_elem(&cuda_malloc_size_cache, &pid_tgid, &size, BPF_ANY);
    return 0;
}

SEC("uretprobe/cudaMalloc")
int handle_cuda_malloc(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 *sizep = bpf_map_lookup_elem(&cuda_malloc_size_cache, &pid_tgid);
    if (!sizep)
        return 0;
    __u64 size = *sizep;
    bpf_map_delete_elem(&cuda_malloc_size_cache, &pid_tgid);

    long ret = (long)PT_REGS_RC(ctx);
    if (ret != 0)
        return 0;

    struct gpu_malloc_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;
    fill_header(&ev->hdr, EVENT_GPU_MALLOC, 0);
    ev->size = size;
    bpf_ringbuf_submit(ev, 0);
    return 0;
}

SEC("uprobe/cudaFree")
int handle_cuda_free(struct pt_regs *ctx) {
    struct gpu_malloc_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;
    fill_header(&ev->hdr, EVENT_GPU_FREE, 0);
    ev->size = 0;
    bpf_ringbuf_submit(ev, 0);
    return 0;
}

// Synchronous cudaMemcpy → treat completion as device-wide sync (Datadog parity).
SEC("uretprobe/cudaMemcpy")
int handle_cuda_memcpy(struct pt_regs *ctx) {
    long ret = (long)PT_REGS_RC(ctx);
    if (ret != 0)
        return 0;

    struct gpu_sync_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;
    fill_header(&ev->hdr, EVENT_GPU_SYNC_DEVICE, 0);
    bpf_ringbuf_submit(ev, 0);
    return 0;
}

// Also count async memcpy bytes without closing spans.
SEC("uprobe/cudaMemcpyAsync")
int handle_cuda_memcpy_async(struct pt_regs *ctx) {
    struct gpu_memcpy_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;
    __u64 stream = 0;
#if defined(__TARGET_ARCH_x86)
    stream = PT_REGS_PARM5(ctx);
#elif defined(__TARGET_ARCH_arm64)
    stream = PT_REGS_PARM5(ctx);
#endif
    fill_header(&ev->hdr, EVENT_GPU_MEMCPY, stream);
    ev->size = PT_REGS_PARM3(ctx);
    ev->kind = (__u8)PT_REGS_PARM4(ctx);
    bpf_ringbuf_submit(ev, 0);
    return 0;
}

SEC("uprobe/cudaStreamSynchronize")
int handle_cuda_stream_sync_enter(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 stream = PT_REGS_PARM1(ctx);
    bpf_map_update_elem(&cuda_sync_cache, &pid_tgid, &stream, BPF_ANY);
    return 0;
}

SEC("uretprobe/cudaStreamSynchronize")
int handle_cuda_stream_sync(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 *streamp = bpf_map_lookup_elem(&cuda_sync_cache, &pid_tgid);
    if (!streamp)
        return 0;
    __u64 stream = *streamp;
    bpf_map_delete_elem(&cuda_sync_cache, &pid_tgid);

    long ret = (long)PT_REGS_RC(ctx);
    if (ret != 0)
        return 0;

    struct gpu_sync_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    // Default stream (0) synchronizes with other streams → device-wide.
    if (stream == 0)
        fill_header(&ev->hdr, EVENT_GPU_SYNC_DEVICE, 0);
    else
        fill_header(&ev->hdr, EVENT_GPU_SYNC, stream);
    bpf_ringbuf_submit(ev, 0);
    return 0;
}

SEC("uretprobe/cudaDeviceSynchronize")
int handle_cuda_device_sync(struct pt_regs *ctx) {
    long ret = (long)PT_REGS_RC(ctx);
    if (ret != 0)
        return 0;

    struct gpu_sync_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;
    fill_header(&ev->hdr, EVENT_GPU_SYNC_DEVICE, 0);
    bpf_ringbuf_submit(ev, 0);
    return 0;
}

SEC("uprobe/cudaSetDevice")
int handle_cuda_set_device_enter(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __s32 device = (__s32)PT_REGS_PARM1(ctx);
    bpf_map_update_elem(&cuda_set_device_cache, &pid_tgid, &device, BPF_ANY);
    return 0;
}

SEC("uretprobe/cudaSetDevice")
int handle_cuda_set_device(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __s32 *devp = bpf_map_lookup_elem(&cuda_set_device_cache, &pid_tgid);
    if (!devp)
        return 0;
    __s32 device = *devp;
    bpf_map_delete_elem(&cuda_set_device_cache, &pid_tgid);

    long ret = (long)PT_REGS_RC(ctx);
    if (ret != 0)
        return 0;

    struct gpu_set_device_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;
    fill_header(&ev->hdr, EVENT_GPU_SET_DEVICE, 0);
    ev->hdr.device_idx = (__u16)device;
    ev->device = device;
    ev->pad = 0;
    bpf_ringbuf_submit(ev, 0);
    return 0;
}
