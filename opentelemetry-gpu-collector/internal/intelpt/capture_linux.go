//go:build linux

package intelpt

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type linuxCapturer struct {
	logger *slog.Logger
	perf   string // path to perf binary, empty if missing
}

// NewCapturer returns a Linux Intel PT capturer. Soft-fails when hardware or
// perf tooling is missing (Available=false).
func NewCapturer(logger *slog.Logger) Capturer {
	if logger == nil {
		logger = slog.Default()
	}
	c := &linuxCapturer{logger: logger}
	if p, err := exec.LookPath("perf"); err == nil {
		c.perf = p
	}
	return c
}

func (c *linuxCapturer) Available() bool {
	if _, err := os.Stat("/sys/bus/event_source/devices/intel_pt/type"); err != nil {
		return false
	}
	return c.perf != ""
}

func (c *linuxCapturer) Capture(opts Options) (Result, error) {
	opts = ClampOptions(opts)
	if !c.Available() {
		return Result{}, ErrUnavailable
	}
	if err := os.MkdirAll(opts.OutputDir, 0o755); err != nil {
		return Result{}, err
	}

	cpus := opts.CPUs
	if len(cpus) == 0 {
		cpus = onlineCPUs(opts.MaxCPUs)
	}
	if len(cpus) > opts.MaxCPUs {
		cpus = cpus[:opts.MaxCPUs]
	}
	if len(cpus) == 0 {
		return Result{}, fmt.Errorf("no CPUs selected for intel pt")
	}

	out := outputPath(opts.OutputDir)
	cpuList := joinInts(cpus)
	// Bounded on-demand capture via perf: idle cost is zero; AUX size capped by -m.
	// -m sets mmap pages for AUX (powers of 2 preferred).
	mmapPages := opts.BufferPages
	duration := time.Duration(opts.DurationMS) * time.Millisecond
	sleepSec := fmt.Sprintf("%.3f", duration.Seconds())

	cmd := exec.Command(c.perf, "record",
		"-o", out,
		"-e", "intel_pt//",
		"-C", cpuList,
		"-m", strconv.Itoa(mmapPages),
		"--", "sleep", sleepSec,
	)
	cmd.Env = append(os.Environ(), "PERF_EXEC_PATH=")
	stderr, err := cmd.CombinedOutput()
	if err != nil {
		_ = os.Remove(out)
		return Result{}, fmt.Errorf("perf intel_pt capture failed: %w (%s)", err, truncate(string(stderr), 512))
	}
	if st, err := os.Stat(out); err != nil || st.Size() == 0 {
		return Result{}, fmt.Errorf("intel pt produced empty output")
	}
	c.logger.Info("intel pt capture complete",
		"path", out,
		"duration_ms", opts.DurationMS,
		"cpus", cpuList,
		"mmap_pages", mmapPages,
	)
	return Result{
		OutputPath: out,
		DurationMS: opts.DurationMS,
		CPUs:       cpus,
		Backend:    "perf",
	}, nil
}

func onlineCPUs(limit int) []int {
	b, err := os.ReadFile("/sys/devices/system/cpu/online")
	if err != nil {
		n := limit
		if n > 4 {
			n = 4
		}
		out := make([]int, n)
		for i := range out {
			out[i] = i
		}
		return out
	}
	var out []int
	for _, part := range strings.Split(strings.TrimSpace(string(b)), ",") {
		part = strings.TrimSpace(part)
		if strings.Contains(part, "-") {
			bounds := strings.SplitN(part, "-", 2)
			lo, e1 := strconv.Atoi(bounds[0])
			hi, e2 := strconv.Atoi(bounds[1])
			if e1 != nil || e2 != nil {
				continue
			}
			for i := lo; i <= hi && len(out) < limit; i++ {
				out = append(out, i)
			}
			continue
		}
		n, err := strconv.Atoi(part)
		if err == nil && len(out) < limit {
			out = append(out, n)
		}
	}
	return out
}

func joinInts(xs []int) string {
	parts := make([]string, len(xs))
	for i, x := range xs {
		parts[i] = strconv.Itoa(x)
	}
	return strings.Join(parts, ",")
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}