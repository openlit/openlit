// GPU event eBPF data structures — stream-sync occupancy wire format.
// License: Apache-2.0

#ifndef __GPUEVENT_H__
#define __GPUEVENT_H__

// Event type (first byte of every event).
#define EVENT_GPU_KERNEL_LAUNCH 1
#define EVENT_GPU_MALLOC        2
#define EVENT_GPU_MEMCPY        3
#define EVENT_GPU_SYNC          4
#define EVENT_GPU_SYNC_DEVICE   5
#define EVENT_GPU_SET_DEVICE    6
#define EVENT_GPU_FREE          7

#define CUDA_MEMCPY_HOST_TO_HOST     0
#define CUDA_MEMCPY_HOST_TO_DEVICE   1
#define CUDA_MEMCPY_DEVICE_TO_HOST   2
#define CUDA_MEMCPY_DEVICE_TO_DEVICE 3

#define DEVICE_IDX_UNKNOWN 0xffff

// Shared header (32 bytes). All events start with this layout.
struct cuda_event_header_t {
    __u8  type;
    __u8  pad0;
    __u16 device_idx; // CUDA device index when known; DEVICE_IDX_UNKNOWN otherwise
    __u32 pid;        // host tgid
    __u32 tid;        // host tid
    __u32 pad1;
    __u64 stream_id;
    __u64 ktime_ns;
};

struct gpu_kernel_launch_t {
    struct cuda_event_header_t hdr;
    __u64 kern_func_off;
    __u32 grid_x;
    __u32 grid_y;
    __u32 grid_z;
    __u32 block_x;
    __u32 block_y;
    __u32 block_z;
    __u32 shared_mem_bytes;
    __u32 pad;
};

struct gpu_malloc_t {
    struct cuda_event_header_t hdr;
    __u64 size;
};

struct gpu_memcpy_t {
    struct cuda_event_header_t hdr;
    __u64 size;
    __u8  kind;
    __u8  pad[7];
};

struct gpu_sync_t {
    struct cuda_event_header_t hdr;
};

struct gpu_set_device_t {
    struct cuda_event_header_t hdr;
    __s32 device;
    __u32 pad;
};

#endif /* __GPUEVENT_H__ */
