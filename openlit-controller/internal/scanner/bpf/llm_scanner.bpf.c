#include "vmlinux.h"
#include "bpf_helpers.h"
#include "bpf_tracing.h"
#include "llm_scanner.h"

char LICENSE[] SEC("license") = "Dual MIT/GPL";

/* max_entries is sized for the built-in SaaS endpoints (each CDN-fronted host
 * resolves to many A records) plus a generous allowance for user-configured
 * custom hosts. A plain HASH (not LRU) is used deliberately: LRU eviction on a
 * discovery map would silently stop detecting a still-valid endpoint. The Go
 * side prunes stale keys on every refresh, so the map cannot grow unbounded
 * from DNS churn. If the ceiling is ever hit, inserts return E2BIG and the
 * resolver logs a warning rather than corrupting existing entries. */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 4096);
    __type(key, struct llm_endpoint_key);
    __type(value, __u8);
} llm_endpoints SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} events SEC(".maps");

SEC("kprobe/tcp_v4_connect")
int BPF_KPROBE(trace_v4, struct sock *sk, struct sockaddr *uaddr) {
    struct sockaddr_in sin = {};
    bpf_probe_read_kernel(&sin, sizeof(sin), uaddr);

    struct llm_endpoint_key key = {
        .addr = sin.sin_addr.s_addr,
        .port = __builtin_bswap16(sin.sin_port),
    };

    __u8 *prov = bpf_map_lookup_elem(&llm_endpoints, &key);
    if (!prov)
        return 0;

    struct llm_event *ev = bpf_ringbuf_reserve(&events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    ev->pid      = pid_tgid >> 32;
    ev->daddr    = key.addr;
    ev->dport    = key.port;
    ev->provider = *prov;
    bpf_get_current_comm(&ev->comm, sizeof(ev->comm));

    bpf_ringbuf_submit(ev, 0);
    return 0;
}

SEC("kprobe/tcp_v6_connect")
int BPF_KPROBE(trace_v6, struct sock *sk, struct sockaddr *uaddr6) {
    struct sockaddr_in6 sin6 = {};
    bpf_probe_read_kernel(&sin6, sizeof(sin6), uaddr6);

    /* Handle IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) */
    __u32 *a32 = (__u32 *)&sin6.sin6_addr;
    if (a32[0] != 0 || a32[1] != 0 || a32[2] != __builtin_bswap32(0x0000FFFF))
        return 0;

    struct llm_endpoint_key key = {
        .addr = a32[3],
        .port = __builtin_bswap16(sin6.sin6_port),
    };

    __u8 *prov = bpf_map_lookup_elem(&llm_endpoints, &key);
    if (!prov)
        return 0;

    struct llm_event *ev = bpf_ringbuf_reserve(&events, sizeof(*ev), 0);
    if (!ev)
        return 0;

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    ev->pid      = pid_tgid >> 32;
    ev->daddr    = key.addr;
    ev->dport    = key.port;
    ev->provider = *prov;
    bpf_get_current_comm(&ev->comm, sizeof(ev->comm));

    bpf_ringbuf_submit(ev, 0);
    return 0;
}
