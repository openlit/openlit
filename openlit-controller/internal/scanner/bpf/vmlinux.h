/* SPDX-License-Identifier: (LGPL-2.1 OR BSD-2-Clause) */
/*
 * Minimal vmlinux.h — hand-maintained subset of kernel types used by
 * llm_scanner.bpf.c.  This avoids a build-time dependency on
 * /sys/kernel/btf/vmlinux (which is unavailable inside Docker BuildKit).
 *
 * Only the types actually referenced by the BPF program are included.
 * CO-RE (preserve_access_index) is applied so the BPF loader can
 * relocate field accesses at runtime if the target kernel's layout
 * differs.
 *
 * To regenerate a full vmlinux.h from a running kernel (local dev):
 *     bpftool btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h
 */

#ifndef __VMLINUX_H__
#define __VMLINUX_H__

#pragma clang attribute push (__attribute__((preserve_access_index)), apply_to = record)

/* ── Basic scalar types ───────────────────────────────────────────── */

typedef unsigned char        __u8;
typedef short unsigned int   __u16;
typedef unsigned int         __u32;
typedef unsigned long long   __u64;
typedef signed char          __s8;
typedef short int            __s16;
typedef int                  __s32;
typedef long long            __s64;

typedef __u16 __be16;
typedef __u32 __be32;
typedef __u64 __be64;
typedef __u32 __wsum;

typedef _Bool bool;
enum { false = 0, true = 1 };

/* ── BPF map types (subset used by map definitions) ───────────────── */

enum bpf_map_type {
	BPF_MAP_TYPE_UNSPEC              = 0,
	BPF_MAP_TYPE_HASH                = 1,
	BPF_MAP_TYPE_ARRAY               = 2,
	BPF_MAP_TYPE_PROG_ARRAY          = 3,
	BPF_MAP_TYPE_PERF_EVENT_ARRAY    = 4,
	BPF_MAP_TYPE_PERCPU_HASH         = 5,
	BPF_MAP_TYPE_PERCPU_ARRAY        = 6,
	BPF_MAP_TYPE_STACK_TRACE         = 7,
	BPF_MAP_TYPE_CGROUP_ARRAY        = 8,
	BPF_MAP_TYPE_LRU_HASH            = 9,
	BPF_MAP_TYPE_LRU_PERCPU_HASH     = 10,
	BPF_MAP_TYPE_LPM_TRIE            = 11,
	BPF_MAP_TYPE_ARRAY_OF_MAPS       = 12,
	BPF_MAP_TYPE_HASH_OF_MAPS        = 13,
	BPF_MAP_TYPE_DEVMAP              = 14,
	BPF_MAP_TYPE_SOCKMAP             = 15,
	BPF_MAP_TYPE_CPUMAP              = 16,
	BPF_MAP_TYPE_XSKMAP             = 17,
	BPF_MAP_TYPE_SOCKHASH            = 18,
	BPF_MAP_TYPE_CGROUP_STORAGE      = 19,
	BPF_MAP_TYPE_REUSEPORT_SOCKARRAY = 20,
	BPF_MAP_TYPE_PERCPU_CGROUP_STORAGE = 21,
	BPF_MAP_TYPE_QUEUE               = 22,
	BPF_MAP_TYPE_STACK               = 23,
	BPF_MAP_TYPE_SK_STORAGE          = 24,
	BPF_MAP_TYPE_DEVMAP_HASH         = 25,
	BPF_MAP_TYPE_STRUCT_OPS          = 26,
	BPF_MAP_TYPE_RINGBUF             = 27,
	BPF_MAP_TYPE_INODE_STORAGE       = 28,
	BPF_MAP_TYPE_TASK_STORAGE        = 29,
	BPF_MAP_TYPE_BLOOM_FILTER        = 30,
	BPF_MAP_TYPE_USER_RINGBUF        = 31,
};

/* ── Opaque kernel types (used only as kprobe parameter types) ──── */

struct sock;
struct sockaddr;

/* ── IPv4 socket address ──────────────────────────────────────────── */

struct in_addr {
	__be32 s_addr;
};

struct sockaddr_in {
	__u16          sin_family;
	__be16         sin_port;
	struct in_addr sin_addr;
	unsigned char  __pad[8];   /* sizeof(struct sockaddr) == 16 */
};

/* ── IPv6 socket address ──────────────────────────────────────────── */

struct in6_addr {
	union {
		__u8   in6_u[16];
	};
};

struct sockaddr_in6 {
	__u16           sin6_family;
	__be16          sin6_port;
	__be32          sin6_flowinfo;
	struct in6_addr sin6_addr;
	__u32           sin6_scope_id;
};

/* ── Architecture-specific pt_regs ────────────────────────────────
 *
 * bpf_tracing.h's BPF_KPROBE macro reads function arguments from
 * registers via struct pt_regs (x86) or struct user_pt_regs (arm64).
 * The field names below must match what bpf_tracing.h expects.
 */

#if defined(__TARGET_ARCH_x86)

struct pt_regs {
	long unsigned int r15;
	long unsigned int r14;
	long unsigned int r13;
	long unsigned int r12;
	long unsigned int bp;
	long unsigned int bx;
	long unsigned int r11;
	long unsigned int r10;
	long unsigned int r9;
	long unsigned int r8;
	long unsigned int ax;
	long unsigned int cx;
	long unsigned int dx;
	long unsigned int si;
	long unsigned int di;
	long unsigned int orig_ax;
	long unsigned int ip;
	long unsigned int cs;
	long unsigned int flags;
	long unsigned int sp;
	long unsigned int ss;
};

#elif defined(__TARGET_ARCH_arm64)

struct user_pt_regs {
	__u64 regs[31];
	__u64 sp;
	__u64 pc;
	__u64 pstate;
};

struct pt_regs {
	struct user_pt_regs user_regs;
	__u64 orig_x0;
	__s32 syscallno;
	__u32 unused2;
};

#endif /* __TARGET_ARCH_* */

#pragma clang attribute pop

#endif /* __VMLINUX_H__ */
