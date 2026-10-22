// Package listen opens the OTLP ports on every address family the machine has.
// Binding only 0.0.0.0 leaves ::1 closed, so clients that resolve localhost to
// IPv6 first never reach the receiver.
package listen

import (
	"errors"
	"net"
	"strconv"
	"syscall"
)

// TCP listens on addr. A wildcard ("" / 0.0.0.0 / ::) listens on IPv6 and,
// when that socket is IPv4-only or IPv6 is unavailable, on IPv4 as well.
func TCP(addr string) ([]net.Listener, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil || !wildcard(host) {
		ln, lerr := net.Listen("tcp", addr)
		if lerr != nil {
			return nil, lerr
		}
		return []net.Listener{ln}, nil
	}
	if port == "" {
		port = "0"
	}

	v6, v6err := net.Listen("tcp", net.JoinHostPort("::", port))
	if v6err != nil {
		ln, lerr := net.Listen("tcp4", net.JoinHostPort("0.0.0.0", port))
		if lerr != nil {
			return nil, lerr
		}
		return []net.Listener{ln}, nil
	}

	gotPort := port
	if tcp, ok := v6.Addr().(*net.TCPAddr); ok {
		gotPort = strconv.Itoa(tcp.Port)
	}
	v4, v4err := net.Listen("tcp4", net.JoinHostPort("0.0.0.0", gotPort))
	if v4err != nil {
		if errors.Is(v4err, syscall.EADDRINUSE) {
			return []net.Listener{v6}, nil
		}
		v6.Close()
		return nil, v4err
	}
	return []net.Listener{v6, v4}, nil
}

func wildcard(host string) bool {
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		return true
	default:
		return false
	}
}
