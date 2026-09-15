package intelpt

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Defaults keep on-demand captures cheap.
const (
	DefaultMaxDurationMS  = 2000
	DefaultMaxBufferPages = 64 // 64 * 4KiB = 256KiB AUX per CPU (perf default page size)
	DefaultMaxCPUs        = 4
	HardMaxDurationMS     = 30000
	HardMaxBufferPages    = 256
	HardMaxCPUs           = 32
)

var (
	ErrUnavailable = errors.New("intel pt unavailable")
	ErrDisabled    = errors.New("intel pt disabled")
)

// Options configures a bounded on-demand Intel PT capture.
type Options struct {
	DurationMS  uint64
	OutputDir   string
	CPUs        []int // empty = first MaxCPUs online CPUs
	MaxCPUs     int
	BufferPages int // AUX buffer pages per CPU
}

// Result is the artifact produced by a capture.
type Result struct {
	OutputPath string
	DurationMS uint64
	CPUs       []int
	Backend    string // "perf" or "native"
}

// Capturer runs bounded Intel PT captures. Idle cost is zero.
type Capturer interface {
	Available() bool
	Capture(opts Options) (Result, error)
}

// ClampOptions applies safety caps so captures cannot runaway.
func ClampOptions(opts Options) Options {
	if opts.DurationMS == 0 {
		opts.DurationMS = 500
	}
	if opts.DurationMS > HardMaxDurationMS {
		opts.DurationMS = HardMaxDurationMS
	}
	if opts.MaxCPUs <= 0 {
		opts.MaxCPUs = DefaultMaxCPUs
	}
	if opts.MaxCPUs > HardMaxCPUs {
		opts.MaxCPUs = HardMaxCPUs
	}
	if opts.BufferPages <= 0 {
		opts.BufferPages = DefaultMaxBufferPages
	}
	if opts.BufferPages > HardMaxBufferPages {
		opts.BufferPages = HardMaxBufferPages
	}
	if opts.OutputDir == "" {
		opts.OutputDir = os.TempDir()
	}
	return opts
}

// SanitizeOutputDir rejects path-traversal sequences and returns a cleaned
// absolute directory. Relative paths are resolved under the process temp dir.
func SanitizeOutputDir(dir string) (string, error) {
	if dir == "" {
		dir = os.TempDir()
	}
	if strings.Contains(dir, "..") {
		return "", fmt.Errorf("intel pt output dir must not contain '..'")
	}
	cleaned := filepath.Clean(dir)
	if !filepath.IsAbs(cleaned) {
		cleaned = filepath.Join(os.TempDir(), cleaned)
	}
	if strings.Contains(cleaned, "..") {
		return "", fmt.Errorf("intel pt output dir is invalid")
	}
	return cleaned, nil
}

func outputPath(dir string) string {
	return filepath.Join(dir, fmt.Sprintf("intel_pt_%d.perf.data", time.Now().UnixNano()))
}
