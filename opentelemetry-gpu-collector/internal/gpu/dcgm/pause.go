package dcgm

import (
	"sync"
	"time"
)

// pauseController tracks a profiling pause deadline and auto-resumes after it.
type pauseController struct {
	mu    sync.Mutex
	until time.Time
	now   func() time.Time
}

func newPauseController() *pauseController {
	return &pauseController{now: time.Now}
}

func (p *pauseController) setNow(now func() time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if now == nil {
		now = time.Now
	}
	p.now = now
}

// Pause arms a pause for duration (from now). Zero or negative clears immediately.
func (p *pauseController) Pause(duration time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if duration <= 0 {
		p.until = time.Time{}
		return
	}
	p.until = p.now().Add(duration)
}

// Resume clears any active pause.
func (p *pauseController) Resume() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.until = time.Time{}
}

// Paused reports whether profiling should be skipped. Auto-resumes when the
// deadline has passed.
func (p *pauseController) Paused() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.until.IsZero() {
		return false
	}
	if !p.now().Before(p.until) {
		p.until = time.Time{}
		return false
	}
	return true
}

// Remaining returns time left in the pause, or 0 when not paused.
func (p *pauseController) Remaining() time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.until.IsZero() {
		return 0
	}
	d := p.until.Sub(p.now())
	if d < 0 {
		p.until = time.Time{}
		return 0
	}
	return d
}
