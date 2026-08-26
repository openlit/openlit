package kineto

import (
	"sync"
	"time"
)

// ClientInfo describes a registered libkineto client process.
type ClientInfo struct {
	PID          int
	JobID        int64
	RegisteredAt time.Time
	LastPoll     time.Time
}

// Registry tracks registered Kineto clients and pending on-demand configs.
type Registry struct {
	mu      sync.Mutex
	clients map[int]*ClientInfo
	pending map[int]string
}

// NewRegistry creates an empty client registry.
func NewRegistry() *Registry {
	return &Registry{
		clients: make(map[int]*ClientInfo),
		pending: make(map[int]string),
	}
}

// Register records or refreshes a client for pid/jobID.
func (r *Registry) Register(pid int, jobID int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	if c, ok := r.clients[pid]; ok {
		c.JobID = jobID
		c.LastPoll = now
		return
	}
	r.clients[pid] = &ClientInfo{
		PID:          pid,
		JobID:        jobID,
		RegisteredAt: now,
		LastPoll:     now,
	}
}

// Touch updates LastPoll for a registered pid (no-op if unknown).
func (r *Registry) Touch(pid int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.clients[pid]; ok {
		c.LastPoll = time.Now()
	}
}

// List returns a snapshot of registered clients.
func (r *Registry) List() []ClientInfo {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]ClientInfo, 0, len(r.clients))
	for _, c := range r.clients {
		out = append(out, *c)
	}
	return out
}

// SetConfig stores pending config for each registered pid in pids.
// Returns the subset of pids that were registered (matched).
func (r *Registry) SetConfig(pids []int, config string) (matched []int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, pid := range pids {
		if _, ok := r.clients[pid]; !ok {
			continue
		}
		r.pending[pid] = config
		matched = append(matched, pid)
	}
	return matched
}

// TakeConfig returns and clears the pending config for pid, if any.
func (r *Registry) TakeConfig(pid int) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cfg, ok := r.pending[pid]
	if !ok {
		return "", false
	}
	delete(r.pending, pid)
	if c, exists := r.clients[pid]; exists {
		c.LastPoll = time.Now()
	}
	return cfg, true
}

// HasClient reports whether pid is registered.
func (r *Registry) HasClient(pid int) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.clients[pid]
	return ok
}
