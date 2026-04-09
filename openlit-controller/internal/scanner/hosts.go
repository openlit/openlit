//go:build linux

package scanner

import (
	"context"
	"net"
	"time"

	"github.com/cilium/ebpf"
	"go.uber.org/zap"
)

var llmHosts = map[string]uint8{
	"api.openai.com":                    1,  // PROVIDER_OPENAI
	"api.anthropic.com":                 2,  // PROVIDER_ANTHROPIC
	"generativelanguage.googleapis.com": 3,  // PROVIDER_GEMINI
	"api.cohere.com":                    4,  // PROVIDER_COHERE
	"api.mistral.ai":                    5,  // PROVIDER_MISTRAL
	"api.groq.com":                      6,  // PROVIDER_GROQ
	"api.deepseek.com":                  7,  // PROVIDER_DEEPSEEK
	"api.together.xyz":                  8,  // PROVIDER_TOGETHER
	"api.fireworks.ai":                  9,  // PROVIDER_FIREWORKS
	"ai-gateway.vercel.sh":              10, // PROVIDER_VERCEL_AI
	"aiplatform.googleapis.com":         11, // PROVIDER_VERTEX_AI
	"models.inference.ai.azure.com":     12, // PROVIDER_AZURE_INFERENCE (GitHub Models)
}

// Well-known Bedrock regions. New regions are detected dynamically if
// the user configures custom hosts.
var bedrockRegions = []string{
	"us-east-1", "us-west-2", "eu-west-1", "ap-northeast-1",
	"ap-southeast-1", "eu-central-1", "us-east-2",
}

func init() {
	var id uint8 = 20
	for _, region := range bedrockRegions {
		llmHosts["bedrock-runtime."+region+".amazonaws.com"] = id
		id++
	}
}

// AddCustomHosts merges user-defined custom LLM hosts into the resolution map.
// A generic provider ID (200+) is assigned. OBI detection determines the
// actual provider from the traffic content.
func AddCustomHosts(customHosts []string) {
	var id uint8 = 200
	for _, host := range customHosts {
		if host == "" {
			continue
		}
		if _, exists := llmHosts[host]; !exists {
			llmHosts[host] = id
			id++
		}
	}
}

// HostResolver periodically resolves LLM API hostnames and updates the BPF map.
type HostResolver struct {
	ipMap  *ebpf.Map
	logger *zap.Logger
}

// NewHostResolver creates a resolver that keeps the BPF IPv4 map updated.
func NewHostResolver(ipMap *ebpf.Map, logger *zap.Logger) *HostResolver {
	return &HostResolver{ipMap: ipMap, logger: logger}
}

// Refresh resolves all LLM hostnames and updates the BPF hash map only.
func (r *HostResolver) Refresh() {
	for host, providerID := range llmHosts {
		ips, err := net.LookupHost(host)
		if err != nil {
			r.logger.Debug("failed to resolve LLM host", zap.String("host", host), zap.Error(err))
			continue
		}
		for _, ipStr := range ips {
			ip := net.ParseIP(ipStr).To4()
			if ip == nil {
				continue
			}
			var key [4]byte
			copy(key[:], ip)
			if err := r.ipMap.Put(key, providerID); err != nil {
				r.logger.Warn("failed to update BPF map", zap.String("ip", ipStr), zap.Error(err))
			}
		}
		r.logger.Debug("resolved LLM host", zap.String("host", host), zap.Int("ips", len(ips)))
	}
}

// RunRefreshLoop refreshes host IPs at the given interval until ctx is cancelled.
func (r *HostResolver) RunRefreshLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.Refresh()
		}
	}
}
