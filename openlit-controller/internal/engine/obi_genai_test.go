package engine

import (
	"testing"

	"github.com/openlit/openlit/openlit-controller/internal/config"
)

func buildGenAI(t *testing.T, providers ...string) obiGenAI {
	t.Helper()
	enabled := make(map[string]bool, len(providers))
	for _, p := range providers {
		enabled[p] = true
	}
	cfg := BuildInstrumentConfig(
		ExportConfig{OTLPEndpoint: "http://localhost:4318"},
		nil,
		enabled,
		nil,
		config.DeployLinux,
		"default",
	)
	return cfg.EBPF.PayloadExtraction.HTTP.GenAI
}

// OpenAI-compatible SaaS vendors all enable the single OpenAI extractor.
func TestBuildInstrumentConfigOpenAICompatibleCollapse(t *testing.T) {
	for _, p := range []string{
		"openai", "cohere", "mistral", "groq", "deepseek", "together",
		"fireworks", "azure_inference", "azure_openai", "vercel_ai", "vertex_ai",
	} {
		g := buildGenAI(t, p)
		if !g.OpenAI.Enabled {
			t.Fatalf("provider %q should enable the OpenAI extractor", p)
		}
		if g.Custom.Enabled || g.Ollama.Enabled {
			t.Fatalf("provider %q should not enable custom/ollama", p)
		}
	}
}

// Native-format providers enable their own extractor, not OpenAI.
func TestBuildInstrumentConfigNativeProviders(t *testing.T) {
	if g := buildGenAI(t, "anthropic"); !g.Anthropic.Enabled || g.OpenAI.Enabled {
		t.Fatalf("anthropic mapping wrong: %+v", g)
	}
	if g := buildGenAI(t, "gemini"); !g.Gemini.Enabled || g.OpenAI.Enabled {
		t.Fatalf("gemini mapping wrong: %+v", g)
	}
	if g := buildGenAI(t, "bedrock"); !g.Bedrock.Enabled || g.OpenAI.Enabled {
		t.Fatalf("bedrock mapping wrong: %+v", g)
	}
	if g := buildGenAI(t, "qwen"); !g.Qwen.Enabled || g.OpenAI.Enabled {
		t.Fatalf("qwen mapping wrong: %+v", g)
	}
}

// Custom gateways enable the custom extractor only.
func TestBuildInstrumentConfigCustomGateway(t *testing.T) {
	g := buildGenAI(t, "custom")
	if !g.Custom.Enabled {
		t.Fatal("custom provider should enable the Custom extractor")
	}
	if g.OpenAI.Enabled || g.Ollama.Enabled {
		t.Fatalf("custom should not enable openai/ollama: %+v", g)
	}
}

// The configured gateway hosts flow into the OBI custom config so the extractor
// can gate on destination.
func TestBuildInstrumentConfigCustomHosts(t *testing.T) {
	cfg := BuildInstrumentConfig(
		ExportConfig{OTLPEndpoint: "http://openlit:4318"},
		nil,
		map[string]bool{"custom": true},
		[]string{"litellm:4000", "vllm:8000"},
		config.DeployLinux,
		"default",
	)
	hosts := cfg.EBPF.PayloadExtraction.HTTP.GenAI.Custom.Hosts
	if len(hosts) != 2 || hosts[0] != "litellm:4000" || hosts[1] != "vllm:8000" {
		t.Fatalf("custom hosts not threaded into config: %+v", hosts)
	}
}

// Ollama (native) is opt-in and maps to its own extractor.
func TestBuildInstrumentConfigOllama(t *testing.T) {
	g := buildGenAI(t, "ollama")
	if !g.Ollama.Enabled {
		t.Fatal("ollama provider should enable the Ollama extractor")
	}
	if g.OpenAI.Enabled || g.Custom.Enabled {
		t.Fatalf("ollama should not enable openai/custom: %+v", g)
	}
}

// No providers → nothing enabled.
func TestBuildInstrumentConfigEmpty(t *testing.T) {
	g := buildGenAI(t)
	if g.OpenAI.Enabled || g.Anthropic.Enabled || g.Gemini.Enabled ||
		g.Qwen.Enabled || g.Bedrock.Enabled || g.Custom.Enabled || g.Ollama.Enabled {
		t.Fatalf("no providers should enable nothing: %+v", g)
	}
}
