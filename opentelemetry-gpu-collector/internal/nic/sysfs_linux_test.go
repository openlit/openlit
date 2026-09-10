//go:build linux

package nic

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIncludeIface(t *testing.T) {
	if !includeIface("eth0", nil, []string{"lo"}) {
		t.Fatal("eth0 should be included when only lo excluded")
	}
	if includeIface("lo", nil, []string{"lo", "lo0"}) {
		t.Fatal("lo should be excluded")
	}
	if includeIface("eth1", []string{"eth0"}, nil) {
		t.Fatal("eth1 should not be in allow list")
	}
	if !includeIface("eth0", []string{"eth0"}, []string{"lo"}) {
		t.Fatal("eth0 should be allowed")
	}
}

func TestReadSysfsFixtures(t *testing.T) {
	root := t.TempDir()
	dev := filepath.Join(root, "eth0")
	if err := os.MkdirAll(filepath.Join(dev, "statistics"), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(rel, val string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dev, rel), []byte(val+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("speed", "10000") // 10 Gb/s → 1_250_000_000 By/s
	write("operstate", "up")
	write("statistics/rx_bytes", "1000")
	write("statistics/tx_bytes", "2000")
	write("statistics/rx_packets", "10")
	write("statistics/tx_packets", "20")
	write("statistics/rx_errors", "1")
	write("statistics/tx_errors", "2")
	write("statistics/rx_dropped", "3")
	write("statistics/tx_dropped", "4")

	// RDMA tree
	ibCounters := filepath.Join(dev, "device", "infiniband", "mlx5_0", "ports", "1", "counters")
	ibHW := filepath.Join(dev, "device", "infiniband", "mlx5_0", "ports", "1", "hw_counters")
	if err := os.MkdirAll(ibCounters, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(ibHW, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ibCounters, "port_xmit_data"), []byte("100\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ibCounters, "port_rcv_data"), []byte("200\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ibCounters, "port_xmit_packets"), []byte("5\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ibHW, "np_cnp_sent"), []byte("7\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	old := sysfsRoot
	sysfsRoot = root
	t.Cleanup(func() { sysfsRoot = old })

	if got := readSpeedBps("eth0"); got != 10_000*1_000_000/8 {
		t.Fatalf("speed = %d, want %d", got, 10_000*1_000_000/8)
	}
	if !readOperstate("eth0") {
		t.Fatal("expected operstate up")
	}
	snap := IfaceSnapshot{Name: "eth0"}
	readSysfsStats(&snap)
	if snap.RxBytes != 1000 || snap.TxBytes != 2000 {
		t.Fatalf("bytes rx/tx = %d/%d", snap.RxBytes, snap.TxBytes)
	}

	rdma := readRDMACounters("eth0", rdmaAllowSet(nil))
	if rdma["port_xmit_data"] != 100 {
		t.Fatalf("port_xmit_data = %v", rdma)
	}
	if rdma["np_cnp_sent"] != 7 {
		t.Fatalf("np_cnp_sent = %v", rdma)
	}
	// Lane width documentation: 100 * 4 = 400 bytes
	if got := rdma["port_xmit_data"] * rdmaLaneWidth; got != 400 {
		t.Fatalf("lane-scaled xmit = %d", got)
	}
}

func TestRDMAAllowSetDefault(t *testing.T) {
	s := rdmaAllowSet(nil)
	if _, ok := s["port_xmit_data"]; !ok {
		t.Fatal("default should include port_xmit_data")
	}
	if _, ok := s["npcnpsent"]; !ok {
		t.Fatal("default should include npcnpsent (lowercased NPCnpSent)")
	}
}
