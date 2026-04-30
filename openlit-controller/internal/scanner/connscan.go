//go:build linux

package scanner

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"math"
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

// Scan finds established connections to known LLM API IPs and attributes each
// connection to the PID that actually owns the socket.
//
// For each PID it:
//  1. Reads /proc/<pid>/net/tcp{,6} to find LLM connections with socket inodes.
//     (In Docker/K8s this is scoped to the container's network namespace;
//     in Linux host mode every PID sees the same global table.)
//  2. Reads /proc/<pid>/fd/ to find which socket inodes this PID owns.
//  3. Only emits events for connections whose socket is owned by this PID.
//
// The fd-ownership check is what makes this correct in Linux host mode where
// all processes share one network namespace.
//
// To avoid redundantly parsing the same /proc/<pid>/net/tcp for PIDs that
// share a network namespace, results are cached by namespace inode.
func (c *ConnScanner) Scan() []LLMConnectEvent {
	if len(c.knownIPs) == 0 {
		return nil
	}

	selfPID := os.Getpid()

	procDirs, err := os.ReadDir(c.procRoot)
	if err != nil {
		c.logger.Debug("cannot read proc root for conn scan", zap.Error(err))
		return nil
	}

	// Cache: netns inode → LLM connections found in that namespace.
	netnsCache := make(map[uint64]map[uint64]connMatch)

	seen := make(map[string]struct{})
	var events []LLMConnectEvent

	for _, entry := range procDirs {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid == selfPID || pid < 0 || pid > math.MaxUint32 {
			continue
		}

		pidDir := filepath.Join(c.procRoot, entry.Name())

		// Determine the network namespace for this PID.
		nsInode := readNetnsInode(pidDir)

		// Step 1: find LLM connections visible to this PID's netns (with inodes).
		inodeToMatch, cached := netnsCache[nsInode]
		if !cached {
			inodeToMatch = make(map[uint64]connMatch)
			for _, variant := range []string{"tcp", "tcp6"} {
				path := filepath.Join(pidDir, "net", variant)
				matches := c.scanTCPFileWithInodes(path, variant == "tcp6")
				for _, m := range matches {
					inodeToMatch[m.inode] = m
				}
			}
			if nsInode != 0 {
				netnsCache[nsInode] = inodeToMatch
			}
		}
		if len(inodeToMatch) == 0 {
			continue
		}

		// Step 2: check which of those sockets this PID actually owns.
		ownedInodes := readSocketInodes(filepath.Join(pidDir, "fd"))
		for _, inode := range ownedInodes {
			m, ok := inodeToMatch[inode]
			if !ok {
				continue
			}
			key := fmt.Sprintf("%d:%s", pid, m.remoteIP)
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}

			provName := providerNames[m.providerID]
			events = append(events, LLMConnectEvent{
				PID:      uint32(pid),
				Provider: provName,
			})
		}
	}
	return events
}

// readNetnsInode reads the network namespace inode for a process via its
// /proc/<pid>/ns/net symlink. Returns 0 if the ns cannot be determined.
func readNetnsInode(pidDir string) uint64 {
	link, err := os.Readlink(filepath.Join(pidDir, "ns", "net"))
	if err != nil {
		return 0
	}
	// Format: "net:[4026531993]"
	start := strings.IndexByte(link, '[')
	end := strings.IndexByte(link, ']')
	if start < 0 || end < 0 || end <= start+1 {
		return 0
	}
	inode, err := strconv.ParseUint(link[start+1:end], 10, 64)
	if err != nil {
		return 0
	}
	return inode
}

// readSocketInodes reads /proc/<pid>/fd/ and returns inode numbers for all
// socket file descriptors (symlinks of the form "socket:[12345]").
func readSocketInodes(fdDir string) []uint64 {
	entries, err := os.ReadDir(fdDir)
	if err != nil {
		return nil
	}
	var inodes []uint64
	for _, e := range entries {
		link, err := os.Readlink(filepath.Join(fdDir, e.Name()))
		if err != nil {
			continue
		}
		if !strings.HasPrefix(link, "socket:[") {
			continue
		}
		inodeStr := link[8 : len(link)-1] // extract number from "socket:[12345]"
		inode, err := strconv.ParseUint(inodeStr, 10, 64)
		if err != nil {
			continue
		}
		inodes = append(inodes, inode)
	}
	return inodes
}

// scanTCPFileWithInodes parses /proc/net/tcp{,6} and returns connections
// to known LLM IPs along with their socket inode numbers.
func (c *ConnScanner) scanTCPFileWithInodes(path string, isV6 bool) []connMatch {
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
		if len(fields) < 10 {
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
		inode, err := strconv.ParseUint(fields[9], 10, 64)
		if err != nil {
			continue
		}
		matches = append(matches, connMatch{remoteIP: ip4, providerID: provID, inode: inode})
	}
	return matches
}

type connMatch struct {
	remoteIP   net.IP
	providerID uint8
	inode      uint64
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
