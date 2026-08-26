// GPU event eBPF probes for CUDA runtime and driver API interception (stream-sync occupancy).
// License: Apache-2.0

//go:build ignore

#include "vmlinux.h"
#include "bpf_helpers.h"
#include "bpf_tracing.h"
#include "gpuevent.h"

// libbpf historically defined PT_REGS_PARM1..5 only. x86-64 SysV passes the
// 6th integer/pointer argument in r9. Keep this behind ifndef so newer
// bpf_tracing.h (which does define PARM6) wins.
#if defined(__TARGET_ARCH_x86) && !defined(PT_REGS_PARM6)
#define PT_REGS_PARM6(x) ((x)->r9)
#endif

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

// CUDA 13 lazily converts the ELF host-function pointer into an opaque
// cudaKernel_t via __cudaGetKernel, then passes that handle to
// cudaLaunchKernel. Retain the relationship so userspace can still resolve a
// stable, human-readable ELF symbol. Older CUDA versions continue to pass the
// host-function pointer directly and do not use these maps.
struct cuda_get_kernel_args_t {
    __u64 out_ptr;
    __u64 host_func;
};

struct cuda_kernel_handle_key_t {
    __u32 pid;
    __u32 pad;
    __u64 handle;
};

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 1024);
    __type(key, __u64);
    __type(value, struct cuda_get_kernel_args_t);
} cuda_get_kernel_cache SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 65536);
    __type(key, struct cuda_kernel_handle_key_t);
    __type(value, __u64);
} cuda_kernel_handles SEC(".maps");

// PIDs that map libcudart.so. Driver launch/graph probes skip these so mixed
// nodes (runtime + driver-only workloads sharing one libcuda inode) are not
// double-counted. Populated from userspace on each rescan.
struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 65536);
    __type(key, __u32);
    __type(value, __u8);
} cudart_pids SEC(".maps");

struct cu_launch_args_t {
    __u64 kern;
    __u64 stream;
    __u32 grid_x;
    __u32 grid_y;
    __u32 grid_z;
    __u32 block_x;
    __u32 block_y;
    __u32 block_z;
    __u32 shared_mem_bytes;
    __u32 pad;
};

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 1024);
    __type(key, __u64);
    __type(value, struct cu_launch_args_t);
} cu_launch_cache SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 1024);
    __type(key, __u64);
    __type(value, __u64);
} cu_graph_launch_cache SEC(".maps");

struct cu_mod_get_fn_args_t {
    __u64 out_ptr;
    __u64 name_ptr;
};

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 1024);
    __type(key, __u64);
    __type(value, struct cu_mod_get_fn_args_t);
} cu_mod_get_fn_cache SEC(".maps");

#define CU_FUNC_NAME_LEN 64

struct cu_func_name_t {
    char name[CU_FUNC_NAME_LEN];
};

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 65536);
    __type(key, struct cuda_kernel_handle_key_t);
    __type(value, struct cu_func_name_t);
} cu_func_names SEC(".maps");

static __always_inline int skip_if_cudart(void) {
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    return bpf_map_lookup_elem(&cudart_pids, &pid) != NULL;
}

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
    // SysV AMD64 splits each 12-byte dim3 aggregate into two eightbytes:
    // rdi=func, rsi/rdx=gridDim, rcx/r8=blockDim, r9=args,
    // [sp+8]=sharedMem, [sp+16]=stream.
    __u64 grid_xy = PT_REGS_PARM2(ctx);
    __u64 grid_z = PT_REGS_PARM3(ctx);
    __u64 block_xy = PT_REGS_PARM4(ctx);
    __u64 block_z = PT_REGS_PARM5(ctx);
    __u64 shared64 = 0;
    bpf_probe_read_user(&shared64, sizeof(shared64), (void *)(ctx->sp + 8));
    bpf_probe_read_user(&stream, sizeof(stream), (void *)(ctx->sp + 16));
    shared = (__u32)shared64;

    ev->grid_x = grid_xy & 0xFFFFFFFF;
    ev->grid_y = grid_xy >> 32;
    ev->grid_z = grid_z & 0xFFFFFFFF;
    ev->block_x = block_xy & 0xFFFFFFFF;
    ev->block_y = block_xy >> 32;
    ev->block_z = block_z & 0xFFFFFFFF;
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
    __u64 kernel = PT_REGS_PARM1(ctx);
    struct cuda_kernel_handle_key_t kernel_key = {
        .pid = ev->hdr.pid,
        .pad = 0,
        .handle = kernel,
    };
    __u64 *host_func = bpf_map_lookup_elem(&cuda_kernel_handles, &kernel_key);
    ev->kern_func_off = host_func ? *host_func : kernel;
    ev->shared_mem_bytes = shared;
    ev->pad = 0; // LAUNCH_KIND_KERNEL

    bpf_ringbuf_submit(ev, 0);
    return 0;
}

SEC("uprobe/__cudaGetKernel")
int handle_cuda_get_kernel_enter(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    struct cuda_get_kernel_args_t args = {
        .out_ptr = PT_REGS_PARM1(ctx),
        .host_func = PT_REGS_PARM2(ctx),
    };
    bpf_map_update_elem(&cuda_get_kernel_cache, &pid_tgid, &args, BPF_ANY);
    return 0;
}

SEC("uretprobe/__cudaGetKernel")
int handle_cuda_get_kernel_exit(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    struct cuda_get_kernel_args_t *args =
        bpf_map_lookup_elem(&cuda_get_kernel_cache, &pid_tgid);
    if (!args)
        return 0;

    // cudaSuccess is zero. On success, *out_ptr contains the opaque handle
    // subsequently supplied as cudaLaunchKernel's first argument.
    if ((__s64)PT_REGS_RC(ctx) == 0 && args->out_ptr && args->host_func) {
        __u64 handle = 0;
        if (bpf_probe_read_user(&handle, sizeof(handle), (void *)args->out_ptr) == 0 && handle) {
            struct cuda_kernel_handle_key_t key = {
                .pid = pid_tgid >> 32,
                .pad = 0,
                .handle = handle,
            };
            bpf_map_update_elem(&cuda_kernel_handles, &key, &args->host_func, BPF_ANY);
        }
    }

    bpf_map_delete_elem(&cuda_get_kernel_cache, &pid_tgid);
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

// cudaLaunchConfig_t view (grid/block dim3 + padding + smem + stream).
struct cuda_launch_config_view {
    __u32 grid_x, grid_y, grid_z, pad0;
    __u32 block_x, block_y, block_z, pad1;
    __u64 dynamic_smem;
    __u64 stream;
};

// cudaLaunchKernelExC(const cudaLaunchConfig_t *config, const void *func, void **args)
SEC("uprobe/cudaLaunchKernelExC")
int handle_cuda_launch_exc(struct pt_regs *ctx) {
    struct gpu_kernel_launch_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    __u64 config_ptr = PT_REGS_PARM1(ctx);
    struct cuda_launch_config_view cfg = {};
    if (config_ptr)
        bpf_probe_read_user(&cfg, sizeof(cfg), (void *)config_ptr);

    fill_header(&ev->hdr, EVENT_GPU_KERNEL_LAUNCH, cfg.stream);
    __u64 kernel = PT_REGS_PARM2(ctx);
    struct cuda_kernel_handle_key_t kernel_key = {
        .pid = ev->hdr.pid,
        .pad = 0,
        .handle = kernel,
    };
    __u64 *host_func = bpf_map_lookup_elem(&cuda_kernel_handles, &kernel_key);
    ev->kern_func_off = host_func ? *host_func : kernel;
    ev->grid_x = cfg.grid_x;
    ev->grid_y = cfg.grid_y;
    ev->grid_z = cfg.grid_z;
    ev->block_x = cfg.block_x;
    ev->block_y = cfg.block_y;
    ev->block_z = cfg.block_z;
    ev->shared_mem_bytes = (__u32)cfg.dynamic_smem;
    ev->pad = 0;

    bpf_ringbuf_submit(ev, 0);
    return 0;
}

// cudaGraphLaunch(cudaGraphExec_t exec, cudaStream_t stream) — graph replay, not a kernel.
SEC("uprobe/cudaGraphLaunch")
int handle_cuda_graph_launch(struct pt_regs *ctx) {
    struct gpu_graph_launch_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    __u64 stream = PT_REGS_PARM2(ctx);
    fill_header(&ev->hdr, EVENT_GPU_GRAPH_LAUNCH, stream);
    bpf_ringbuf_submit(ev, 0);
    return 0;
}

struct cuda_event_record_args_t {
    __u64 event;
    __u64 stream;
};

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 1024);
    __type(key, __u64);
    __type(value, struct cuda_event_record_args_t);
} cuda_event_record_cache SEC(".maps");

// event handle → stream last recorded on
struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 65536);
    __type(key, __u64);
    __type(value, __u64);
} cuda_event_streams SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 1024);
    __type(key, __u64);
    __type(value, __u64);
} cuda_event_sync_cache SEC(".maps");

// cudaEventRecord(cudaEvent_t event, cudaStream_t stream)
SEC("uprobe/cudaEventRecord")
int handle_cuda_event_record_enter(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    struct cuda_event_record_args_t args = {
        .event = PT_REGS_PARM1(ctx),
        .stream = PT_REGS_PARM2(ctx),
    };
    bpf_map_update_elem(&cuda_event_record_cache, &pid_tgid, &args, BPF_ANY);
    return 0;
}

SEC("uretprobe/cudaEventRecord")
int handle_cuda_event_record_exit(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    struct cuda_event_record_args_t *args =
        bpf_map_lookup_elem(&cuda_event_record_cache, &pid_tgid);
    if (!args)
        return 0;
    __u64 event = args->event;
    __u64 stream = args->stream;
    bpf_map_delete_elem(&cuda_event_record_cache, &pid_tgid);

    if ((__s64)PT_REGS_RC(ctx) != 0 || !event)
        return 0;
    bpf_map_update_elem(&cuda_event_streams, &event, &stream, BPF_ANY);
    return 0;
}

// cudaEventSynchronize(cudaEvent_t event)
SEC("uprobe/cudaEventSynchronize")
int handle_cuda_event_sync_enter(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 event = PT_REGS_PARM1(ctx);
    bpf_map_update_elem(&cuda_event_sync_cache, &pid_tgid, &event, BPF_ANY);
    return 0;
}

SEC("uretprobe/cudaEventSynchronize")
int handle_cuda_event_sync_exit(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 *eventp = bpf_map_lookup_elem(&cuda_event_sync_cache, &pid_tgid);
    if (!eventp)
        return 0;
    __u64 event = *eventp;
    bpf_map_delete_elem(&cuda_event_sync_cache, &pid_tgid);

    if ((__s64)PT_REGS_RC(ctx) != 0)
        return 0;

    __u64 stream = 0;
    __u64 *streamp = bpf_map_lookup_elem(&cuda_event_streams, &event);
    if (streamp)
        stream = *streamp;

    struct gpu_sync_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;
    if (stream == 0)
        fill_header(&ev->hdr, EVENT_GPU_SYNC_DEVICE, 0);
    else
        fill_header(&ev->hdr, EVENT_GPU_SYNC, stream);
    bpf_ringbuf_submit(ev, 0);
    return 0;
}

static __always_inline void emit_cu_kernel_launch(struct cu_launch_args_t *args) {
    struct gpu_kernel_launch_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return;
    fill_header(&ev->hdr, EVENT_GPU_KERNEL_LAUNCH, args->stream);
    ev->kern_func_off = args->kern;
    ev->grid_x = args->grid_x;
    ev->grid_y = args->grid_y;
    ev->grid_z = args->grid_z;
    ev->block_x = args->block_x;
    ev->block_y = args->block_y;
    ev->block_z = args->block_z;
    ev->shared_mem_bytes = args->shared_mem_bytes;
    ev->pad = 0;
    bpf_ringbuf_submit(ev, 0);
}

// Driver API: cuLaunchKernel(f, gx,gy,gz, bx,by,bz, shared, stream, params, extra)
SEC("uprobe/cuLaunchKernel")
int handle_cu_launch_kernel(struct pt_regs *ctx) {
    if (skip_if_cudart())
        return 0;

    struct cu_launch_args_t args = {};
    args.kern = PT_REGS_PARM1(ctx);
#if defined(__TARGET_ARCH_x86)
    // rdi=f, rsi=gx, rdx=gy, rcx=gz, r8=bx, r9=by, [sp+8]=bz, [sp+16]=shared, [sp+24]=stream
    args.grid_x = (__u32)PT_REGS_PARM2(ctx);
    args.grid_y = (__u32)PT_REGS_PARM3(ctx);
    args.grid_z = (__u32)PT_REGS_PARM4(ctx);
    args.block_x = (__u32)PT_REGS_PARM5(ctx);
    args.block_y = (__u32)PT_REGS_PARM6(ctx);
    __u64 bz = 0;
    bpf_probe_read_user(&bz, sizeof(bz), (void *)(ctx->sp + 8));
    args.block_z = (__u32)bz;
    __u64 shared64 = 0;
    bpf_probe_read_user(&shared64, sizeof(shared64), (void *)(ctx->sp + 16));
    args.shared_mem_bytes = (__u32)shared64;
    bpf_probe_read_user(&args.stream, sizeof(args.stream), (void *)(ctx->sp + 24));
#elif defined(__TARGET_ARCH_arm64)
    {
        struct user_pt_regs *regs = (struct user_pt_regs *)ctx;
        args.grid_x = (__u32)regs->regs[1];
        args.grid_y = (__u32)regs->regs[2];
        args.grid_z = (__u32)regs->regs[3];
        args.block_x = (__u32)regs->regs[4];
        args.block_y = (__u32)regs->regs[5];
        args.block_z = (__u32)regs->regs[6];
        args.shared_mem_bytes = (__u32)regs->regs[7];
        bpf_probe_read_user(&args.stream, sizeof(args.stream), (void *)(regs->sp));
    }
#else
#error "cuLaunchKernel argument decoding not implemented for this architecture"
#endif

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    bpf_map_update_elem(&cu_launch_cache, &pid_tgid, &args, BPF_ANY);
    return 0;
}

SEC("uretprobe/cuLaunchKernel")
int handle_cu_launch_kernel_exit(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    struct cu_launch_args_t *args = bpf_map_lookup_elem(&cu_launch_cache, &pid_tgid);
    if (!args)
        return 0;
    struct cu_launch_args_t copy = *args;
    bpf_map_delete_elem(&cu_launch_cache, &pid_tgid);

    if (skip_if_cudart())
        return 0;
    if ((__s64)PT_REGS_RC(ctx) != 0)
        return 0;
    emit_cu_kernel_launch(&copy);
    return 0;
}

// CUlaunchConfig: 7×u32 then 4-byte pad then CUstream (not cudaLaunchConfig_t).
struct cu_launch_config_view {
    __u32 grid_x, grid_y, grid_z;
    __u32 block_x, block_y, block_z;
    __u32 shared_mem_bytes;
    __u32 pad;
    __u64 stream;
};

// cuLaunchKernelEx(const CUlaunchConfig *config, CUfunction f, void **params, void **extra)
SEC("uprobe/cuLaunchKernelEx")
int handle_cu_launch_kernel_ex(struct pt_regs *ctx) {
    if (skip_if_cudart())
        return 0;

    struct cu_launch_args_t args = {};
    args.kern = PT_REGS_PARM2(ctx);
    __u64 config_ptr = PT_REGS_PARM1(ctx);
    struct cu_launch_config_view cfg = {};
    if (config_ptr)
        bpf_probe_read_user(&cfg, sizeof(cfg), (void *)config_ptr);
    args.grid_x = cfg.grid_x;
    args.grid_y = cfg.grid_y;
    args.grid_z = cfg.grid_z;
    args.block_x = cfg.block_x;
    args.block_y = cfg.block_y;
    args.block_z = cfg.block_z;
    args.shared_mem_bytes = cfg.shared_mem_bytes;
    args.stream = cfg.stream;

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    bpf_map_update_elem(&cu_launch_cache, &pid_tgid, &args, BPF_ANY);
    return 0;
}

SEC("uretprobe/cuLaunchKernelEx")
int handle_cu_launch_kernel_ex_exit(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    struct cu_launch_args_t *args = bpf_map_lookup_elem(&cu_launch_cache, &pid_tgid);
    if (!args)
        return 0;
    struct cu_launch_args_t copy = *args;
    bpf_map_delete_elem(&cu_launch_cache, &pid_tgid);

    if (skip_if_cudart())
        return 0;
    if ((__s64)PT_REGS_RC(ctx) != 0)
        return 0;
    emit_cu_kernel_launch(&copy);
    return 0;
}

// cuGraphLaunch(CUgraphExec hGraphExec, CUstream hStream)
SEC("uprobe/cuGraphLaunch")
int handle_cu_graph_launch(struct pt_regs *ctx) {
    if (skip_if_cudart())
        return 0;
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 stream = PT_REGS_PARM2(ctx);
    bpf_map_update_elem(&cu_graph_launch_cache, &pid_tgid, &stream, BPF_ANY);
    return 0;
}

SEC("uretprobe/cuGraphLaunch")
int handle_cu_graph_launch_exit(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 *streamp = bpf_map_lookup_elem(&cu_graph_launch_cache, &pid_tgid);
    if (!streamp)
        return 0;
    __u64 stream = *streamp;
    bpf_map_delete_elem(&cu_graph_launch_cache, &pid_tgid);

    if (skip_if_cudart())
        return 0;
    if ((__s64)PT_REGS_RC(ctx) != 0)
        return 0;

    struct gpu_graph_launch_t *ev;
    ev = bpf_ringbuf_reserve(&gpu_events, sizeof(*ev), 0);
    if (!ev)
        return 0;
    fill_header(&ev->hdr, EVENT_GPU_GRAPH_LAUNCH, stream);
    bpf_ringbuf_submit(ev, 0);
    return 0;
}

// cuModuleGetFunction(CUfunction *hfunc, CUmodule hmod, const char *name)
SEC("uprobe/cuModuleGetFunction")
int handle_cu_module_get_function_enter(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    struct cu_mod_get_fn_args_t args = {
        .out_ptr = PT_REGS_PARM1(ctx),
        .name_ptr = PT_REGS_PARM3(ctx),
    };
    bpf_map_update_elem(&cu_mod_get_fn_cache, &pid_tgid, &args, BPF_ANY);
    return 0;
}

SEC("uretprobe/cuModuleGetFunction")
int handle_cu_module_get_function_exit(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    struct cu_mod_get_fn_args_t *args = bpf_map_lookup_elem(&cu_mod_get_fn_cache, &pid_tgid);
    if (!args)
        return 0;
    __u64 out_ptr = args->out_ptr;
    __u64 name_ptr = args->name_ptr;
    bpf_map_delete_elem(&cu_mod_get_fn_cache, &pid_tgid);

    if ((__s64)PT_REGS_RC(ctx) != 0 || !out_ptr || !name_ptr)
        return 0;

    __u64 handle = 0;
    if (bpf_probe_read_user(&handle, sizeof(handle), (void *)out_ptr) != 0 || !handle)
        return 0;

    struct cu_func_name_t nm = {};
    bpf_probe_read_user_str(&nm.name, sizeof(nm.name), (void *)name_ptr);

    struct cuda_kernel_handle_key_t key = {
        .pid = pid_tgid >> 32,
        .pad = 0,
        .handle = handle,
    };
    bpf_map_update_elem(&cu_func_names, &key, &nm, BPF_ANY);
    return 0;
}
