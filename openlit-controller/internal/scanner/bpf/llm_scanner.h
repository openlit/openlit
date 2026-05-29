#ifndef __LLM_SCANNER_H
#define __LLM_SCANNER_H

/* Provider IDs are assigned and interpreted on the Go side (see
 * internal/scanner/types.go); these defines are informational. Built-in SaaS
 * providers use 1-12 (+ Bedrock regions 20-26); all user-configured custom
 * gateways collapse to a single PROVIDER_CUSTOM. */
#define PROVIDER_OPENAI     1
#define PROVIDER_ANTHROPIC  2
#define PROVIDER_GEMINI     3
#define PROVIDER_COHERE     4
#define PROVIDER_MISTRAL    5
#define PROVIDER_GROQ       6
#define PROVIDER_DEEPSEEK   7
#define PROVIDER_TOGETHER   8
#define PROVIDER_FIREWORKS  9
#define PROVIDER_CUSTOM     13

/* Key for the llm_endpoints map: destination IPv4 (network byte order) plus
 * destination port (host byte order). Keying on IP+port lets us match
 * self-hosted proxies that listen on non-443 ports (LiteLLM :4000,
 * Ollama :11434, vLLM :8000, ...) without false-positive matching every
 * connection to a shared IP. __attribute__((packed)) keeps the key layout
 * identical between the BPF program and the Go side. */
struct llm_endpoint_key {
    __u32 addr; /* IPv4, network byte order */
    __u16 port; /* destination port, host byte order */
} __attribute__((packed));

struct llm_event {
    __u32 pid;
    __u32 daddr;
    __u16 dport;
    __u8  provider;
    char  comm[16];
};

#endif /* __LLM_SCANNER_H */
