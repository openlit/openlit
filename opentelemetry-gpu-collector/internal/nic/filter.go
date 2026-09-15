package nic

// includeIface returns whether ifname should be collected given allow/exclude lists.
// An empty allow list means all non-excluded interfaces.
func includeIface(ifname string, allow, exclude []string) bool {
	for _, ex := range exclude {
		if ifname == ex {
			return false
		}
	}
	if len(allow) == 0 {
		return true
	}
	for _, a := range allow {
		if ifname == a {
			return true
		}
	}
	return false
}

// rdmaAllowSet builds a case-insensitive set of allowed RDMA counter names.
func rdmaAllowSet(counters []string) map[string]struct{} {
	src := counters
	if len(src) == 0 {
		src = DefaultRDMACounters
	}
	out := make(map[string]struct{}, len(src))
	for _, c := range src {
		out[toLowerASCII(c)] = struct{}{}
	}
	return out
}

func toLowerASCII(s string) string {
	b := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		b[i] = c
	}
	return string(b)
}
