package tpu

import (
	"bufio"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Sample is one Prometheus exposition sample.
type Sample struct {
	Name   string
	Labels map[string]string
	Value  float64
}

// Scraper fetches and filters TPU device-plugin Prometheus metrics.
type Scraper struct {
	endpoint  string
	timeout   time.Duration
	allowlist []string
	client    *http.Client
}

// NewScraper creates a scraper for the given endpoint.
// Empty allowlist means use the default prefixes.
func NewScraper(endpoint string, timeoutMS int, allowlist []string) *Scraper {
	if timeoutMS <= 0 {
		timeoutMS = 2000
	}
	if len(allowlist) == 0 {
		allowlist = []string{
			"duty_cycle",
			"tensorcore_utilization",
			"memory_total",
			"memory_used",
			"memory_bandwidth_utilization",
		}
	}
	timeout := time.Duration(timeoutMS) * time.Millisecond
	return &Scraper{
		endpoint:  endpoint,
		timeout:   timeout,
		allowlist: append([]string(nil), allowlist...),
		client: &http.Client{
			Timeout: timeout,
		},
	}
}

// Scrape performs an HTTP GET and returns allowlisted samples.
func (s *Scraper) Scrape() ([]Sample, error) {
	req, err := http.NewRequest(http.MethodGet, s.endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	samples := ParsePrometheusText(string(body))
	return filterAllowlist(samples, s.allowlist), nil
}

func filterAllowlist(samples []Sample, allowlist []string) []Sample {
	if len(allowlist) == 0 {
		return samples
	}
	out := make([]Sample, 0, len(samples))
	for _, s := range samples {
		if nameAllowed(s.Name, allowlist) {
			out = append(out, s)
		}
	}
	return out
}

func nameAllowed(name string, allowlist []string) bool {
	for _, prefix := range allowlist {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

// ParsePrometheusText parses Prometheus text exposition format.
// Drops +Inf/-Inf/NaN samples. Handles HELP/TYPE comments and label escapes.
func ParsePrometheusText(body string) []Sample {
	var out []Sample
	sc := bufio.NewScanner(strings.NewReader(body))
	// Allow long lines from high-cardinality labels.
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if len(line) > 0 && line[len(line)-1] == '\r' {
			line = line[:len(line)-1]
		}
		if line == "" || line[0] == '#' {
			continue
		}
		sample, ok := parseSampleLine(line)
		if !ok {
			continue
		}
		out = append(out, sample)
	}
	return out
}

func parseSampleLine(line string) (Sample, bool) {
	i := 0
	for i < len(line) && line[i] != '{' && line[i] != ' ' && line[i] != '\t' {
		i++
	}
	if i == 0 {
		return Sample{}, false
	}
	name := line[:i]
	rest := line[i:]
	labels := map[string]string{}
	if len(rest) > 0 && rest[0] == '{' {
		rest = rest[1:]
		var ok bool
		labels, rest, ok = parseLabels(rest)
		if !ok {
			return Sample{}, false
		}
	}
	value, ok := parseValue(rest)
	if !ok {
		return Sample{}, false
	}
	return Sample{Name: name, Labels: labels, Value: value}, true
}

func parseLabels(s string) (map[string]string, string, bool) {
	labels := map[string]string{}
	for {
		s = skipWS(s)
		if s == "" {
			return nil, "", false
		}
		if s[0] == '}' {
			return labels, s[1:], true
		}
		eq := strings.IndexByte(s, '=')
		if eq <= 0 {
			return nil, "", false
		}
		key := s[:eq]
		s = s[eq+1:]
		val, next, ok := parseLabelValue(s)
		if !ok {
			return nil, "", false
		}
		labels[key] = val
		s = skipWS(next)
		if s != "" && s[0] == ',' {
			s = s[1:]
		}
	}
}

func parseLabelValue(s string) (string, string, bool) {
	if s == "" || s[0] != '"' {
		return "", "", false
	}
	s = s[1:]
	var b strings.Builder
	for len(s) > 0 {
		r, size := utf8.DecodeRuneInString(s)
		if r == utf8.RuneError && size == 1 {
			return "", "", false
		}
		if r == '"' {
			return b.String(), s[size:], true
		}
		if r == '\\' {
			s = s[size:]
			if s == "" {
				return "", "", false
			}
			esc, esz := utf8.DecodeRuneInString(s)
			switch esc {
			case 'n':
				b.WriteByte('\n')
			default:
				b.WriteRune(esc)
			}
			s = s[esz:]
			continue
		}
		b.WriteRune(r)
		s = s[size:]
	}
	return "", "", false
}

func parseValue(s string) (float64, bool) {
	s = skipWS(s)
	if s == "" {
		return 0, false
	}
	end := 0
	for end < len(s) && s[end] != ' ' && s[end] != '\t' {
		end++
	}
	token := s[:end]
	switch token {
	case "+Inf", "-Inf", "Inf", "NaN":
		return 0, false
	}
	v, err := strconv.ParseFloat(token, 64)
	if err != nil || math.IsInf(v, 0) || math.IsNaN(v) {
		return 0, false
	}
	return v, true
}

func skipWS(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	return s
}
