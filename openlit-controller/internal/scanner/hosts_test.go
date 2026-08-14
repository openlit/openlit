//go:build linux

package scanner

import (
	"encoding/binary"
	"net"
	"os"
	"path/filepath"
	"testing"

	"go.uber.org/zap"
)

func TestParseCustomHostSpecs(t *testing.T) {
	logger, _ := zap.NewDevelopment()

	cases := []struct {
		spec     string
		wantHost string
		wantPort uint16
		wantProv uint8
	}{
		// Every custom spec maps to providerCustom regardless of port — we do not
		// infer the specific vendor from the port.
		{"litellm.internal:4000", "litellm.internal", 4000, providerCustom},
		{"ollama.local:11434", "ollama.local", 11434, providerCustom},
		{"vllm.svc:8000", "vllm.svc", 8000, providerCustom},
		{"my-azure.openai.azure.com", "my-azure.openai.azure.com", 443, providerCustom},
		{"  gateway.internal:9999  ", "gateway.internal", 9999, providerCustom},
		{"127.0.0.1:11434", "127.0.0.1", 11434, providerCustom},
	}

	for _, tc := range cases {
		got := ParseCustomHostSpecs([]string{tc.spec}, logger)
		if len(got) != 1 {
			t.Fatalf("spec %q: expected 1 target, got %d", tc.spec, len(got))
		}
		tgt := got[0]
		if tgt.Host != tc.wantHost || tgt.Port != tc.wantPort || tgt.ProviderID != tc.wantProv {
			t.Fatalf("spec %q: got %+v, want host=%s port=%d prov=%d",
				tc.spec, tgt, tc.wantHost, tc.wantPort, tc.wantProv)
		}
	}
}

func TestParseCustomHostSpecsSkipsInvalid(t *testing.T) {
	logger, _ := zap.NewDevelopment()

	// Empty, blank, zero-port and non-numeric-port specs are dropped.
	got := ParseCustomHostSpecs([]string{"", "   ", "host:0", "host:notaport"}, logger)
	if len(got) != 0 {
		t.Fatalf("expected all invalid specs dropped, got %d: %+v", len(got), got)
	}
}

func TestParseHexIPPortNon443(t *testing.T) {
	// A0000F:0FA0 → 4000 in hex is 0FA0; build "0A00000A:0FA0" = 10.0.0.10:4000
	ip, port := parseHexIPPort("0A00000A:0FA0", false)
	if port != 4000 {
		t.Fatalf("expected port 4000, got %d", port)
	}
	if ip == nil || ip[0] != 10 || ip[3] != 10 {
		t.Fatalf("unexpected IP %s", ip)
	}
}

// TestScanTCPFileMatchesNon443 verifies the connscan no longer hard-requires
// port 443: a LiteLLM-style connection on :4000 is matched when its endpoint
// (IP+port) is in the known set.
func TestScanTCPFileMatchesNon443(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	cs := NewConnScanner("/proc", logger)

	// 10.0.0.10:4000
	key := endpointKey{Port: 4000}
	key.Addr[0], key.Addr[1], key.Addr[2], key.Addr[3] = 10, 0, 0, 10
	cs.knownEndpoints[key] = providerCustom

	dir := t.TempDir()
	tcpFile := filepath.Join(dir, "tcp")
	// rem_address 0A00000A:0FA0 = 10.0.0.10:4000, state 01 (ESTABLISHED), inode 55555
	content := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:C350 0A00000A:0FA0 01 00000000:00000000 00:00000000 00000000     0        0 55555 1 0000000000000000 100 0 0 10 0
`
	if err := os.WriteFile(tcpFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	matches := cs.scanTCPFileWithInodes(tcpFile, false, cs.knownEndpoints)
	if len(matches) != 1 {
		t.Fatalf("expected 1 non-443 match, got %d", len(matches))
	}
	if matches[0].remotePort != 4000 || matches[0].providerID != providerCustom {
		t.Fatalf("unexpected match %+v", matches[0])
	}
}

// TestScanTCPFileIgnoresWrongPort verifies that a connection to a known IP on a
// port that is NOT in the endpoint set is ignored (no IP-only matching).
func TestScanTCPFileIgnoresWrongPort(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	cs := NewConnScanner("/proc", logger)

	// Known endpoint is 10.0.0.10:4000 ...
	key := endpointKey{Port: 4000}
	key.Addr[0], key.Addr[1], key.Addr[2], key.Addr[3] = 10, 0, 0, 10
	cs.knownEndpoints[key] = providerCustom

	dir := t.TempDir()
	tcpFile := filepath.Join(dir, "tcp")
	// ... but the connection is to 10.0.0.10:443 (0FA0 → 01BB), should NOT match.
	content := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:C350 0A00000A:01BB 01 00000000:00000000 00:00000000 00000000     0        0 55555 1 0000000000000000 100 0 0 10 0
`
	if err := os.WriteFile(tcpFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	matches := cs.scanTCPFileWithInodes(tcpFile, false, cs.knownEndpoints)
	if len(matches) != 0 {
		t.Fatalf("expected no match for known IP on unknown port, got %d", len(matches))
	}
}

func TestEndpointKeyMarshalBinary(t *testing.T) {
	key := endpointKey{Port: 11434}
	key.Addr[0], key.Addr[1], key.Addr[2], key.Addr[3] = 127, 0, 0, 1

	b, err := key.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	if len(b) != 6 {
		t.Fatalf("expected 6-byte key, got %d", len(b))
	}
	if b[0] != 127 || b[1] != 0 || b[2] != 0 || b[3] != 1 {
		t.Fatalf("addr bytes wrong: %v", b[:4])
	}
	// Port stored little-endian to match the bpfel struct layout.
	if got := binary.LittleEndian.Uint16(b[4:6]); got != 11434 {
		t.Fatalf("expected port 11434 LE, got %d", got)
	}
}

func TestResolveTargetsLiteralIP(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	resolved := resolveTargets([]llmTarget{
		{Host: "10.1.2.3", Port: 4000, ProviderID: providerCustom},
	}, logger)

	var key endpointKey
	copy(key.Addr[:], net.ParseIP("10.1.2.3").To4())
	key.Port = 4000
	if resolved[key] != providerCustom {
		t.Fatalf("expected literal IP target resolved to litellm, got %+v", resolved)
	}
}
