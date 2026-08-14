// Package tailfile reads the last N bytes of a file as a slice of
// JSONL lines, dropping a partial first line.
//
// We use it for cost-rollup paths that need to scan transcripts at
// hook end-of-session. Reading the whole file is unsafe — long
// sessions can produce multi-MB or larger files and the hook process
// is on a tight latency budget (< 1s p99). Bounding the read keeps
// the worst case predictable at the cost of undercounting tokens for
// sessions that span more than `cap` bytes of transcript.
//
// F3: Phase F task in the coding-agents plan. The cap default is
// chosen to comfortably cover a few hours of dense usage while still
// fitting in memory on small CI runners.
package tailfile

import (
	"bufio"
	"bytes"
	"io"
	"os"
)

// DefaultCap is the byte budget for a tail-read. 4 MiB lets a
// Claude/Codex session of ~30k turns be read entirely; only outlier
// marathon sessions get truncated. Tunable per-call via Tail's cap
// parameter, but exported because adapters share this value as
// their canonical default.
const DefaultCap int64 = 4 * 1024 * 1024

// LineCap caps the maximum line length the scanner will accept.
// JSONL records that exceed this are skipped (not fatal). 1 MiB
// is comfortably larger than any Anthropic/OpenAI usage line.
const LineCap = 1 * 1024 * 1024

// Tail returns up to `cap` bytes from the end of `path` split into
// lines, with the first (possibly partial) line discarded. Returns
// an empty slice if the file is missing/unreadable so callers can
// treat the result as "best effort, nothing to roll up".
func Tail(path string, cap int64) [][]byte {
	if path == "" {
		return nil
	}
	if cap <= 0 {
		cap = DefaultCap
	}
	f, err := os.Open(path) //nolint:gosec // path comes from the agent's own payload
	if err != nil {
		return nil
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil
	}
	size := info.Size()
	start := int64(0)
	truncated := false
	if size > cap {
		start = size - cap
		truncated = true
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil
	}

	// We use Scanner with a custom buffer because the default 64 KiB
	// is below realistic usage-record line size on long Claude turns.
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), LineCap)

	var out [][]byte
	first := true
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		// When we seeked into the middle of the file, the first
		// "line" is almost certainly truncated JSON — discard it
		// so we don't pollute the caller with garbage records.
		if first {
			first = false
			if truncated {
				continue
			}
		}
		if len(line) == 0 {
			continue
		}
		// Copy because Scanner reuses the underlying buffer.
		buf := make([]byte, len(line))
		copy(buf, line)
		out = append(out, buf)
	}
	return out
}
