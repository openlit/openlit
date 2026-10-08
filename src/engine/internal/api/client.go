// Package api talks to the OpenLIT server's internal realtime routes. Both
// routes are authenticated with the per-install cron job secret.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/openlit/openlit/engine/internal/engine"
	"github.com/openlit/openlit/engine/internal/rules"
)

const (
	RulesPath    = "/api/internal/realtime/rules"
	FindingsPath = "/api/internal/realtime/findings"
)

type Client struct {
	baseURL   string
	secret    string
	http      *http.Client
	queue     chan engine.Finding
	delivered atomic.Uint64
	failed    atomic.Uint64
	dropped   atomic.Uint64
	wg        sync.WaitGroup
	closeOnce sync.Once
	done      chan struct{}
}

func New(baseURL, secret string) *Client {
	c := &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		secret:  secret,
		http:    &http.Client{Timeout: 10 * time.Second},
		queue:   make(chan engine.Finding, 1000),
		done:    make(chan struct{}),
	}
	c.wg.Add(1)
	go c.run()
	return c
}

func (c *Client) authorize(req *http.Request) {
	req.Header.Set("X-CRON-JOB", c.secret)
}

type rulesResponse struct {
	Rules []rules.Rule `json:"rules"`
}

func (c *Client) FetchRules(ctx context.Context) ([]rules.Rule, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+RulesPath, nil)
	if err != nil {
		return nil, err
	}
	c.authorize(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("rules: status %d", resp.StatusCode)
	}
	var out rulesResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&out); err != nil {
		return nil, err
	}
	return out.Rules, nil
}

// Emit queues a finding for delivery without blocking evaluation.
func (c *Client) Emit(f engine.Finding) {
	select {
	case c.queue <- f:
	default:
		c.dropped.Add(1)
	}
}

func (c *Client) run() {
	defer c.wg.Done()
	for {
		select {
		case f := <-c.queue:
			c.deliver(f)
		case <-c.done:
			for {
				select {
				case f := <-c.queue:
					c.deliver(f)
				default:
					return
				}
			}
		}
	}
}

func (c *Client) deliver(f engine.Finding) {
	body, err := json.Marshal(f)
	if err != nil {
		c.failed.Add(1)
		return
	}
	backoff := 500 * time.Millisecond
	for attempt := 0; attempt < 4; attempt++ {
		status, err := c.post(body)
		if err == nil && status >= 200 && status < 300 {
			c.delivered.Add(1)
			return
		}
		if err == nil && status >= 400 && status < 500 && status != http.StatusTooManyRequests {
			log.Printf("api: finding %s rejected with status %d", f.RuleID, status)
			c.failed.Add(1)
			return
		}
		select {
		case <-time.After(backoff):
		case <-c.done:
		}
		backoff *= 2
	}
	log.Printf("api: finding %s delivery failed", f.RuleID)
	c.failed.Add(1)
}

func (c *Client) post(body []byte) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+FindingsPath, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	c.authorize(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
	return resp.StatusCode, nil
}

type Stats struct {
	Delivered uint64 `json:"delivered"`
	Failed    uint64 `json:"failed"`
	Dropped   uint64 `json:"dropped"`
}

func (c *Client) Stats() Stats {
	return Stats{Delivered: c.delivered.Load(), Failed: c.failed.Load(), Dropped: c.dropped.Load()}
}

func (c *Client) Close() {
	c.closeOnce.Do(func() {
		close(c.done)
		c.wg.Wait()
	})
}
