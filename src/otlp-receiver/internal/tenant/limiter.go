package tenant

import (
	"container/list"
	"errors"
	"net"
	"sync"
	"time"
)

// ErrRateLimited is returned when a client IP has sent too many rejected keys.
var ErrRateLimited = errors.New("too many failed authentication attempts")

const defaultLimiterClients = 10000

// FailLimiter is a per-IP token bucket charged only for rejected API keys, so
// key guessing and cache flooding slow down without affecting valid senders.
// The client map is bounded: the least recently seen IPs are evicted first.
type FailLimiter struct {
	burst      float64
	perSecond  float64
	maxClients int
	now        func() time.Time

	mu      sync.Mutex
	clients map[string]*list.Element
	lru     *list.List
}

type bucket struct {
	ip     string
	tokens float64
	last   time.Time
}

// NewFailLimiter returns nil (no limiting) when burst or perMinute is not positive.
func NewFailLimiter(burst, perMinute int) *FailLimiter {
	if burst <= 0 || perMinute <= 0 {
		return nil
	}
	return &FailLimiter{
		burst:      float64(burst),
		perSecond:  float64(perMinute) / 60,
		maxClients: defaultLimiterClients,
		now:        time.Now,
		clients:    map[string]*list.Element{},
		lru:        list.New(),
	}
}

// Allow reports whether ip may attempt authentication. It does not consume a token.
func (l *FailLimiter) Allow(ip string) bool {
	if l == nil || ip == "" {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	el, ok := l.clients[ip]
	if !ok {
		return true
	}
	b := el.Value.(*bucket)
	l.refill(b)
	return b.tokens >= 1
}

// Fail charges ip for one rejected key.
func (l *FailLimiter) Fail(ip string) {
	if l == nil || ip == "" {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	el, ok := l.clients[ip]
	if !ok {
		el = l.lru.PushFront(&bucket{ip: ip, tokens: l.burst, last: l.now()})
		l.clients[ip] = el
		for l.lru.Len() > l.maxClients {
			oldest := l.lru.Back()
			l.lru.Remove(oldest)
			delete(l.clients, oldest.Value.(*bucket).ip)
		}
	} else {
		l.lru.MoveToFront(el)
	}
	b := el.Value.(*bucket)
	l.refill(b)
	if b.tokens >= 1 {
		b.tokens--
	} else {
		b.tokens = 0
	}
}

func (l *FailLimiter) refill(b *bucket) {
	now := l.now()
	if elapsed := now.Sub(b.last).Seconds(); elapsed > 0 {
		b.tokens += elapsed * l.perSecond
		if b.tokens > l.burst {
			b.tokens = l.burst
		}
	}
	b.last = now
}

// Len reports the number of tracked IPs.
func (l *FailLimiter) Len() int {
	if l == nil {
		return 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.clients)
}

// ClientIP extracts the host from a host:port remote address. Forwarded
// headers are ignored on purpose: they are client-controlled.
func ClientIP(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}
