//go:build linux

package scanner

import (
	"encoding/binary"
	"net"
	"strconv"
	"strings"

	"github.com/cilium/ebpf"
	"go.uber.org/zap"
)

// endpointKey mirrors `struct llm_endpoint_key` in bpf/llm_scanner.h. The
// layout (u32 addr in network byte order, u16 port in host byte order, packed)
// must stay byte-identical to the C struct so BPF map lookups match.
type endpointKey struct {
	Addr [4]byte
	Port uint16
}

// llmTarget describes one hostname (or IP) to monitor, the destination port,
// and the provider ID to attribute matched connections to.
type llmTarget struct {
	Host       string
	Port       uint16
	ProviderID uint8
}

// builtinTargets are the public SaaS LLM endpoints, all on HTTPS (443).
var builtinTargets = []llmTarget{
	{Host: "api.openai.com", Port: 443, ProviderID: 1},                    // PROVIDER_OPENAI
	{Host: "api.anthropic.com", Port: 443, ProviderID: 2},                 // PROVIDER_ANTHROPIC
	{Host: "generativelanguage.googleapis.com", Port: 443, ProviderID: 3}, // PROVIDER_GEMINI
	{Host: "api.cohere.com", Port: 443, ProviderID: 4},                    // PROVIDER_COHERE
	{Host: "api.mistral.ai", Port: 443, ProviderID: 5},                    // PROVIDER_MISTRAL
	{Host: "api.groq.com", Port: 443, ProviderID: 6},                      // PROVIDER_GROQ
	{Host: "api.deepseek.com", Port: 443, ProviderID: 7},                  // PROVIDER_DEEPSEEK
	{Host: "api.together.xyz", Port: 443, ProviderID: 8},                  // PROVIDER_TOGETHER
	{Host: "api.fireworks.ai", Port: 443, ProviderID: 9},                  // PROVIDER_FIREWORKS
	{Host: "ai-gateway.vercel.sh", Port: 443, ProviderID: 10},             // PROVIDER_VERCEL_AI
	{Host: "aiplatform.googleapis.com", Port: 443, ProviderID: 11},        // PROVIDER_VERTEX_AI
	{Host: "models.inference.ai.azure.com", Port: 443, ProviderID: 12},    // PROVIDER_AZURE_INFERENCE (GitHub Models)
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
		builtinTargets = append(builtinTargets, llmTarget{
			Host:       "bedrock-runtime." + region + ".amazonaws.com",
			Port:       443,
			ProviderID: id,
		})
		id++
	}
}

// HostResolver periodically resolves LLM API hostnames and updates the BPF map.
// It owns the set of targets (built-in + user-configured custom hosts) and the
// last-resolved BPF keys so it can prune stale entries on each refresh.
type HostResolver struct {
	epMap   *ebpf.Map
	logger  *zap.Logger
	targets []llmTarget
	custom  []llmTarget
	live    map[endpointKey]struct{} // keys currently programmed into the BPF map
}

// NewHostResolver creates a resolver that keeps the BPF endpoint map updated.
func NewHostResolver(epMap *ebpf.Map, logger *zap.Logger) *HostResolver {
	r := &HostResolver{
		epMap:  epMap,
		logger: logger,
		live:   make(map[endpointKey]struct{}),
	}
	r.rebuildTargets()
	return r
}

// SetCustomTargets replaces the user-configured custom targets. The combined
// target set takes effect on the next Refresh.
func (r *HostResolver) SetCustomTargets(custom []llmTarget) {
	r.custom = custom
	r.rebuildTargets()
}

func (r *HostResolver) rebuildTargets() {
	combined := make([]llmTarget, 0, len(builtinTargets)+len(r.custom))
	combined = append(combined, builtinTargets...)
	combined = append(combined, r.custom...)
	r.targets = combined
}

// Targets returns the current combined target set (built-in + custom).
func (r *HostResolver) Targets() []llmTarget {
	out := make([]llmTarget, len(r.targets))
	copy(out, r.targets)
	return out
}

// applyResolved reconciles the BPF endpoint map against a freshly resolved set:
// it adds keys for newly resolved IP+port pairs and removes keys that are no
// longer present (e.g. after DNS changes or a custom host being removed).
func (r *HostResolver) applyResolved(resolved map[endpointKey]uint8) {
	next := make(map[endpointKey]struct{}, len(resolved))
	for key, providerID := range resolved {
		next[key] = struct{}{}
		if err := r.epMap.Put(key, providerID); err != nil {
			r.logger.Warn("failed to update BPF endpoint map",
				zap.String("ip", net.IP(key.Addr[:]).String()),
				zap.Uint16("port", key.Port),
				zap.Error(err))
		}
	}

	for key := range r.live {
		if _, ok := next[key]; !ok {
			if err := r.epMap.Delete(key); err != nil {
				r.logger.Debug("failed to delete stale BPF endpoint",
					zap.String("ip", net.IP(key.Addr[:]).String()),
					zap.Uint16("port", key.Port),
					zap.Error(err))
			}
		}
	}
	r.live = next
}

// resolveTargets resolves every target's host to its IPv4 addresses and returns
// the BPF endpoint keys (IP+port) mapped to the provider ID. Targets whose host
// is already a literal IP are used directly without a DNS lookup, which is the
// common case for self-hosted proxies addressed by IP.
func resolveTargets(targets []llmTarget, logger *zap.Logger) map[endpointKey]uint8 {
	out := make(map[endpointKey]uint8, len(targets)*2)
	for _, t := range targets {
		var ips []net.IP
		if ip := net.ParseIP(t.Host); ip != nil {
			ips = []net.IP{ip}
		} else {
			addrs, err := net.LookupHost(t.Host)
			if err != nil {
				if logger != nil {
					logger.Debug("failed to resolve LLM host", zap.String("host", t.Host), zap.Error(err))
				}
				continue
			}
			for _, a := range addrs {
				if ip := net.ParseIP(a); ip != nil {
					ips = append(ips, ip)
				}
			}
		}
		for _, ip := range ips {
			ip4 := ip.To4()
			if ip4 == nil {
				continue
			}
			var key endpointKey
			copy(key.Addr[:], ip4)
			key.Port = t.Port
			out[key] = t.ProviderID
		}
		if logger != nil {
			logger.Debug("resolved LLM target",
				zap.String("host", t.Host),
				zap.Uint16("port", t.Port),
				zap.Int("ips", len(ips)))
		}
	}
	return out
}

// ParseCustomHostSpecs converts user-supplied "host[:port]" strings into
// targets. A spec without a port defaults to 443. IPv6 literal hosts must be
// bracketed (e.g. "[::1]:11434"); they are accepted here but only IPv4
// resolution is currently honoured downstream. Invalid specs are logged and
// skipped rather than failing the whole update.
func ParseCustomHostSpecs(specs []string, logger *zap.Logger) []llmTarget {
	targets := make([]llmTarget, 0, len(specs))
	for _, raw := range specs {
		spec := strings.TrimSpace(raw)
		if spec == "" {
			continue
		}

		host := spec
		var port uint16 = 443

		if h, p, err := net.SplitHostPort(spec); err == nil {
			pn, perr := strconv.ParseUint(p, 10, 16)
			if perr != nil || pn == 0 {
				if logger != nil {
					logger.Warn("skipping custom LLM host with invalid port", zap.String("spec", spec))
				}
				continue
			}
			host = h
			port = uint16(pn)
		} else if strings.Contains(spec, ":") && !strings.HasPrefix(spec, "[") {
			// A bare IPv6 literal (e.g. "::1") trips SplitHostPort; treat the
			// whole spec as the host on the default port.
			if ip := net.ParseIP(spec); ip == nil {
				if logger != nil {
					logger.Warn("skipping malformed custom LLM host", zap.String("spec", spec))
				}
				continue
			}
		}

		host = strings.TrimSpace(host)
		if host == "" {
			continue
		}

		targets = append(targets, llmTarget{
			Host:       host,
			Port:       port,
			ProviderID: providerCustom,
		})
	}
	return targets
}

// MarshalBinary encodes endpointKey to match the packed C struct layout:
// 4-byte addr (already network byte order) followed by 2-byte port in the
// host byte order the BPF program stores it in. cilium/ebpf calls this when
// the key implements encoding.BinaryMarshaler.
func (k endpointKey) MarshalBinary() ([]byte, error) {
	b := make([]byte, 6)
	copy(b[0:4], k.Addr[:])
	binary.LittleEndian.PutUint16(b[4:6], k.Port)
	return b, nil
}
