package listen

import (
	"net"
	"strconv"
	"testing"
)

func TestWildcardReachesIPv4(t *testing.T) {
	lns, err := TCP("0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, ln := range lns {
			ln.Close()
		}
	})
	port := lns[0].Addr().(*net.TCPAddr).Port
	conn, err := net.Dial("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		t.Fatalf("ipv4 localhost: %v", err)
	}
	conn.Close()
}

func TestWildcardReachesIPv6(t *testing.T) {
	probe, err := net.Listen("tcp", "[::1]:0")
	if err != nil {
		t.Skip("ipv6 is not available")
	}
	probe.Close()

	lns, err := TCP(":0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, ln := range lns {
			ln.Close()
		}
	})
	port := lns[0].Addr().(*net.TCPAddr).Port
	conn, err := net.Dial("tcp6", net.JoinHostPort("::1", strconv.Itoa(port)))
	if err != nil {
		t.Fatalf("ipv6 localhost: %v", err)
	}
	conn.Close()
}

func TestSpecificHostStaysSpecific(t *testing.T) {
	lns, err := TCP("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lns[0].Close() })
	if len(lns) != 1 {
		t.Fatalf("listeners: %d", len(lns))
	}
	if lns[0].Addr().(*net.TCPAddr).IP.String() != "127.0.0.1" {
		t.Fatalf("bound %s", lns[0].Addr())
	}
}
