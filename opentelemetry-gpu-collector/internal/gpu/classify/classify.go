// Package classify detects LLM-related workload frameworks from process identity.
package classify

import "strings"

// Result is the classification of a GPU process.
type Result struct {
	Kind      string // llm_inference | llm_training | other
	Framework string // vllm | ollama | llama.cpp | sglang | tgi | triton | ray | pytorch | unknown
}

type rule struct {
	substr    string
	framework string
	kind      string
}

// Ordered from more specific to less specific.
var rules = []rule{
	{"ray::", "ray", "llm_inference"},
	{"vllm", "vllm", "llm_inference"},
	{"ollama", "ollama", "llm_inference"},
	{"llama-server", "llama.cpp", "llm_inference"},
	{"llama.cpp", "llama.cpp", "llm_inference"},
	{"llama_cpp", "llama.cpp", "llm_inference"},
	{"text-generation-launcher", "tgi", "llm_inference"},
	{"text-generation-server", "tgi", "llm_inference"},
	{"sglang", "sglang", "llm_inference"},
	{"tritonserver", "triton", "llm_inference"},
	{"torchrun", "pytorch", "llm_training"},
	{"pytorch", "pytorch", "llm_training"},
	{"transformers.trainer", "pytorch", "llm_training"},
	{"deepspeed", "pytorch", "llm_training"},
}

// FromProcess classifies using executable name and command line (case-insensitive).
func FromProcess(exe, cmdline string) Result {
	hay := strings.ToLower(exe + " " + cmdline)
	for _, r := range rules {
		if strings.Contains(hay, r.substr) {
			return Result{Kind: r.kind, Framework: r.framework}
		}
	}
	return Result{Kind: "other", Framework: "unknown"}
}
