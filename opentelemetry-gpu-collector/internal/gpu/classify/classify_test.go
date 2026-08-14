package classify

import "testing"

func TestFromProcess(t *testing.T) {
	cases := []struct {
		exe, cmd string
		kind, fw string
	}{
		{"python", "python -m vllm.entrypoints.openai.api_server", "llm_inference", "vllm"},
		{"ollama", "/usr/local/bin/ollama serve", "llm_inference", "ollama"},
		{"llama-server", "./llama-server -m model.gguf", "llm_inference", "llama.cpp"},
		{"python", "ray::ServeReplica:app1:VLLMDeployment", "llm_inference", "ray"},
		{"torchrun", "torchrun train.py", "llm_training", "pytorch"},
		{"bash", "sleep 10", "other", "unknown"},
	}
	for _, c := range cases {
		got := FromProcess(c.exe, c.cmd)
		if got.Kind != c.kind || got.Framework != c.fw {
			t.Errorf("FromProcess(%q,%q)=%+v want kind=%s fw=%s", c.exe, c.cmd, got, c.kind, c.fw)
		}
	}
}
