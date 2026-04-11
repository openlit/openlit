#include "vmlinux.h"
#include "bpf_helpers.h"
#include "bpf_tracing.h"
#include "llm_scanner.h"

char LICENSE[] SEC("license") = "Dual MIT/GPL";

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 512);
    __type(key, __u32);
    __type(value, __u8);
} llm_ipv4 SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} events SEC(".maps");

SEC("kprobe/tcp_v4_connect")
int BPF_KPROBE(trace_v4, struct sock *sk, struct sockaddr *uaddr) {
    struct sockaddr_in sin = {};
    bpf_probe_read_kernel(&sin, sizeof(sin), uaddr);

    if (__builtin_bswap16(sin.sin_port) != 443)
        return 0;

    __u8 *prov = bpf_map_lookup_elem(&llm_ipv4, &sin.sin_addr.s_addr);
    if (!prov)
        return 0;

    struct llm_event *ev = bpf_ringbuf_reserve(&events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    ev->pid      = pid_tgid >> 32;
    ev->daddr    = sin.sin_addr.s_addr;
    ev->dport    = 443;
    ev->provider = *prov;
    bpf_get_current_comm(&ev->comm, sizeof(ev->comm));

    bpf_ringbuf_submit(ev, 0);
    return 0;
}

SEC("kprobe/tcp_v6_connect")
int BPF_KPROBE(trace_v6, struct sock *sk, struct sockaddr *uaddr6) {
    struct sockaddr_in6 sin6 = {};
    bpf_probe_read_kernel(&sin6, sizeof(sin6), uaddr6);

    if (__builtin_bswap16(sin6.sin6_port) != 443)
        return 0;

    /* Handle IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) */
    __u32 *a32 = (__u32 *)&sin6.sin6_addr;
    if (a32[0] != 0 || a32[1] != 0 || a32[2] != __builtin_bswap32(0x0000FFFF))
        return 0;

    __u8 *prov = bpf_map_lookup_elem(&llm_ipv4, &a32[3]);
    if (!prov)
        return 0;

    struct llm_event *ev = bpf_ringbuf_reserve(&events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    ev->pid      = pid_tgid >> 32;
    ev->daddr    = a32[3];
    ev->dport    = 443;
    ev->provider = *prov;
    bpf_get_current_comm(&ev->comm, sizeof(ev->comm));

    bpf_ringbuf_submit(ev, 0);
    return 0;
}
