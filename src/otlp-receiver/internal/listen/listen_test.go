package listen

import (
	"errors"
	"net"
	"strconv"
	"syscall"
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

func TestEADDRINUSEOnIPv6OnlyIsAnError(t *testing.T) {
	ln, err := net.Listen("tcp", "[::1]:0")
	if err != nil {
		t.Skip("ipv6 is not available")
	}
	if dualStack(ln) {
		ln.Close()
		t.Fatal("[::1] listener reported dual-stack")
	}
	got, err := afterIPv4Failure(ln, syscall.EADDRINUSE)
	if err == nil {
		for _, l := range got {
			l.Close()
		}
		t.Fatal("expected EADDRINUSE")
	}
	if !errors.Is(err, syscall.EADDRINUSE) {
		t.Fatalf("error: %v", err)
	}
}

func TestMissingIPv4KeepsIPv6(t *testing.T) {
	ln, err := net.Listen("tcp", "[::1]:0")
	if err != nil {
		t.Skip("ipv6 is not available")
	}
	got, err := afterIPv4Failure(ln, syscall.EAFNOSUPPORT)
	if err != nil {
		ln.Close()
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != ln {
		t.Fatalf("listeners: %v", got)
	}
	ln.Close()
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
