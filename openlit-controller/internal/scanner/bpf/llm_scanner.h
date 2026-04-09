#ifndef __LLM_SCANNER_H
#define __LLM_SCANNER_H

#define PROVIDER_OPENAI     1
#define PROVIDER_ANTHROPIC  2
#define PROVIDER_GEMINI     3
#define PROVIDER_COHERE     4
#define PROVIDER_MISTRAL    5
#define PROVIDER_GROQ       6
#define PROVIDER_DEEPSEEK   7
#define PROVIDER_TOGETHER   8
#define PROVIDER_FIREWORKS  9

struct llm_event {
    __u32 pid;
    __u32 daddr;
    __u16 dport;
    __u8  provider;
    char  comm[16];
};

#endif /* __LLM_SCANNER_H */
