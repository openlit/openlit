//go:build linux

package scanner

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"go.uber.org/zap"
)

const tcpEstablished = "01"

// ConnScanner scans /proc/net/tcp{,6} for established connections to known
// LLM API IPs. This catches connections that already existed before the
// kprobe was attached (e.g. apps with long-lived HTTP keep-alive pools).
type ConnScanner struct {
	procRoot string
	knownIPs map[[4]byte]uint8 // IPv4 -> provider_id (mirrors BPF map)
	logger   *zap.Logger
}

func NewConnScanner(procRoot string, logger *zap.Logger) *ConnScanner {
	return &ConnScanner{
		procRoot: procRoot,
		knownIPs: make(map[[4]byte]uint8),
		logger:   logger,
	}
}

// UpdateIPs rebuilds the known-IP set from resolved LLM hosts.
// Called after each HostResolver.Refresh().
func (c *ConnScanner) UpdateIPs(resolved map[string][]net.IP) {
	c.knownIPs = make(map[[4]byte]uint8, len(resolved)*4)
	for host, ips := range resolved {
		provID, ok := llmHosts[host]
		if !ok {
			continue
		}
		for _, ip := range ips {
			ip4 := ip.To4()
			if ip4 == nil {
				continue
			}
			var key [4]byte
			copy(key[:], ip4)
			c.knownIPs[key] = provID
		}
	}
}

// Scan iterates over all PIDs and reads each process's /proc/<pid>/net/tcp{,6}
// to find established connections to known LLM IPs. This covers all network
// namespaces, including containerized processes.
func (c *ConnScanner) Scan() []LLMConnectEvent {
	if len(c.knownIPs) == 0 {
		return nil
	}

	procDirs, err := os.ReadDir(c.procRoot)
	if err != nil {
		c.logger.Debug("cannot read proc root for conn scan", zap.Error(err))
		return nil
	}

	seen := make(map[string]struct{}) // dedupe by "pid:remoteIP"
	var events []LLMConnectEvent

	for _, entry := range procDirs {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}

		for _, variant := range []string{"tcp", "tcp6"} {
			path := filepath.Join(c.procRoot, entry.Name(), "net", variant)
			matches := c.scanTCPFile(path, variant == "tcp6")
			for _, m := range matches {
				key := fmt.Sprintf("%d:%s", pid, m.remoteIP)
				if _, dup := seen[key]; dup {
					continue
				}
				seen[key] = struct{}{}

				provName, _ := providerNames[m.providerID]
				events = append(events, LLMConnectEvent{
					PID:      uint32(pid),
					Provider: provName,
					DestIP:   m.remoteIP.String(),
					DestPort: 443,
				})
			}
		}
	}
	return events
}

// scanTCPFile parses a single /proc/<pid>/net/tcp{,6} file and returns
// connections to known LLM IPs.
func (c *ConnScanner) scanTCPFile(path string, isV6 bool) []connMatch {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var matches []connMatch
	sc := bufio.NewScanner(f)
	sc.Scan() // skip header

	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 4 {
			continue
		}
		if fields[3] != tcpEstablished {
			continue
		}
		ip4, port := parseHexIPPort(fields[2], isV6)
		if ip4 == nil || port != 443 {
			continue
		}
		var key [4]byte
		copy(key[:], ip4)
		provID, ok := c.knownIPs[key]
		if !ok {
			continue
		}
		matches = append(matches, connMatch{remoteIP: ip4, providerID: provID})
	}
	return matches
}

type connMatch struct {
	remoteIP   net.IP
	providerID uint8
}


// parseHexIPPort parses "AABBCCDD:01BB" (IPv4) or 32-char hex for IPv6.
// For IPv6, only IPv4-mapped addresses (::ffff:x.x.x.x) are returned.
func parseHexIPPort(s string, isV6 bool) (net.IP, uint16) {
	parts := strings.SplitN(s, ":", 2)
	if len(parts) != 2 {
		return nil, 0
	}

	portVal, err := strconv.ParseUint(parts[1], 16, 16)
	if err != nil {
		return nil, 0
	}

	ipHex := parts[0]
	if isV6 {
		if len(ipHex) != 32 {
			return nil, 0
		}
		// Check for IPv4-mapped: 00000000 00000000 FFFF0000 <ipv4>
		// /proc/net/tcp6 stores each 32-bit group in host byte order (LE on LE machines)
		group3 := ipHex[16:24]
		if group3 != "FFFF0000" && group3 != "0000FFFF" {
			return nil, 0
		}
		ipHex = ipHex[24:32]
	}

	if len(ipHex) != 8 {
		return nil, 0
	}

	raw, err := hex.DecodeString(ipHex)
	if err != nil {
		return nil, 0
	}

	// /proc/net/tcp stores IPs in host byte order (little-endian on LE machines),
	// so we reverse to get network byte order.
	ip := net.IPv4(raw[3], raw[2], raw[1], raw[0])
	return ip.To4(), uint16(portVal)
}


// ResolveAllHosts resolves all LLM hostnames and returns the results.
// Used to feed both the BPF map and the ConnScanner's known IP set.
func ResolveAllHosts() map[string][]net.IP {
	resolved := make(map[string][]net.IP, len(llmHosts))
	for host := range llmHosts {
		addrs, err := net.LookupHost(host)
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ip := net.ParseIP(a).To4()
			if ip != nil {
				resolved[host] = append(resolved[host], ip)
			}
		}
	}
	return resolved
}

// RefreshAndUpdateBoth refreshes DNS, updates both the BPF map and ConnScanner IPs.
func RefreshAndUpdateBoth(resolver *HostResolver, connScan *ConnScanner, logger *zap.Logger) {
	resolved := ResolveAllHosts()
	for host, ips := range resolved {
		provID := llmHosts[host]
		for _, ip := range ips {
			var key [4]byte
			copy(key[:], ip.To4())
			if err := resolver.ipMap.Put(key, provID); err != nil {
				logger.Warn("failed to update BPF map", zap.String("ip", ip.String()), zap.Error(err))
			}
		}
		logger.Debug("resolved LLM host", zap.String("host", host), zap.Int("ips", len(ips)))
	}
	connScan.UpdateIPs(resolved)
	logger.Debug("updated conn scanner IPs", zap.Int("total_ips", countIPs(resolved)))
}

func countIPs(m map[string][]net.IP) int {
	n := 0
	for _, ips := range m {
		n += len(ips)
	}
	return n
}

