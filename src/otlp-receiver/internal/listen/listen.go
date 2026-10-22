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
		return afterIPv4Failure(v6, v4err)
	}
	return []net.Listener{v6, v4}, nil
}

// afterIPv4Failure decides what an IPv4 wildcard failure means.
// EADDRINUSE is the dual-stack socket already covering IPv4 only when that
// socket is not IPv6-only. An unrelated listener on the same port must fail
// the bind. A machine with no IPv4 stack keeps the IPv6 listener.
func afterIPv4Failure(v6 net.Listener, v4err error) ([]net.Listener, error) {
	if errors.Is(v4err, syscall.EADDRINUSE) && dualStack(v6) {
		return []net.Listener{v6}, nil
	}
	if ipv4Unavailable(v4err) {
		return []net.Listener{v6}, nil
	}
	v6.Close()
	return nil, v4err
}

func dualStack(ln net.Listener) bool {
	tcp, ok := ln.(*net.TCPListener)
	if !ok {
		return false
	}
	if addr, ok := tcp.Addr().(*net.TCPAddr); !ok || (addr.IP != nil && !addr.IP.IsUnspecified()) {
		return false
	}
	raw, err := tcp.SyscallConn()
	if err != nil {
		return false
	}
	var v6only int
	var getErr error
	err = raw.Control(func(fd uintptr) {
		v6only, getErr = syscall.GetsockoptInt(int(fd), syscall.IPPROTO_IPV6, syscall.IPV6_V6ONLY)
	})
	return err == nil && getErr == nil && v6only == 0
}

func ipv4Unavailable(err error) bool {
	return errors.Is(err, syscall.EAFNOSUPPORT) || errors.Is(err, syscall.EPROTONOSUPPORT)
}

func wildcard(host string) bool {
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		return true
	default:
		return false
	}
}
