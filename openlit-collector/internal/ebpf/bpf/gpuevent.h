// GPU event eBPF data structures.
// Adapted from OpenTelemetry eBPF Instrumentation (OBI) v0.4.1
// Original: https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation
// License: Apache-2.0

#ifndef __GPUEVENT_H__
#define __GPUEVENT_H__

#define MAX_STACK_DEPTH 128
#define MAX_KERNEL_ARGS 16

// Event type flags (stored in first byte).
#define EVENT_GPU_KERNEL_LAUNCH 1
#define EVENT_GPU_MALLOC        2
#define EVENT_GPU_MEMCPY        3

// cudaMemcpyKind enum values.
#define CUDA_MEMCPY_HOST_TO_HOST     0
#define CUDA_MEMCPY_HOST_TO_DEVICE   1
#define CUDA_MEMCPY_DEVICE_TO_HOST   2
#define CUDA_MEMCPY_DEVICE_TO_DEVICE 3

struct pid_info_t {
    __u32 host_pid;
    __u32 user_pid;
    __u32 ns;
};

struct gpu_kernel_launch_t {
    __u8  flags;
    struct pid_info_t pid_info;
    __u64 kern_func_off;
    __u32 grid_x;
    __u32 grid_y;
    __u32 grid_z;
    __u32 block_x;
    __u32 block_y;
    __u32 block_z;
    __u64 stream;
    __u64 args[MAX_KERNEL_ARGS];
    __u64 ustack[MAX_STACK_DEPTH];
};

struct gpu_malloc_t {
    __u8  flags;
    struct pid_info_t pid_info;
    __u64 size;
};

struct gpu_memcpy_t {
    __u8  flags;
    __u8  kind;
    struct pid_info_t pid_info;
    __u64 size;
};

#endif /* __GPUEVENT_H__ */
