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
	"errors"
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

// MaxMatchLine bounds the memory EachLineContaining spends on a single
// line. Claude Code assistant lines can carry large tool_use inputs (a whole
// file for Write), so this sits far above LineCap; a longer line is streamed
// through and checked for the needle without being buffered.
const MaxMatchLine = 16 * 1024 * 1024

// ErrLineTooLong reports that a line containing the needle exceeded
// MaxMatchLine and was skipped, so a rollup built from fn is incomplete.
var ErrLineTooLong = errors.New("tailfile: line containing needle exceeds MaxMatchLine")

// EachLineContaining streams every line of path that contains needle to fn,
// with no file-size cap and at most MaxMatchLine bytes of one line in memory.
// Used by end-of-session rollups that must see the whole transcript: tool
// results make transcripts grow past DefaultCap within minutes, so a tail
// read undercounts usage.
//
// It returns any non-EOF read error, and ErrLineTooLong if a matching line
// had to be skipped; in both cases the caller must not treat what fn saw as
// complete. fn's slice is only valid during the call.
func EachLineContaining(path string, needle []byte, fn func(line []byte)) error {
	f, err := os.Open(path) //nolint:gosec // path comes from the agent's own payload
	if err != nil {
		return err
	}
	defer f.Close()
	return eachLineContaining(f, needle, MaxMatchLine, fn)
}

func eachLineContaining(src io.Reader, needle []byte, maxLine int, fn func(line []byte)) error {
	r := bufio.NewReaderSize(src, 64*1024)
	var (
		line      []byte // current line, while it fits in maxLine
		oversized bool   // current line outgrew maxLine; only scanning it now
		hit       bool   // the oversized line contains needle
		tail      []byte // last len(needle)-1 bytes seen, so a needle split across chunks is found
		skipped   bool
	)
	// scan checks an oversized line's chunk for the needle, including across the chunk boundary.
	scan := func(chunk []byte) {
		joined := append(tail, chunk...)
		if bytes.Contains(joined, needle) {
			hit = true
		}
		if keep := len(needle) - 1; keep > 0 && len(joined) > keep {
			tail = append(tail[:0], joined[len(joined)-keep:]...)
		} else {
			tail = append(tail[:0], joined...)
		}
	}
	for {
		chunk, err := r.ReadSlice('\n')
		if len(chunk) > 0 {
			switch {
			case oversized:
				scan(chunk)
			case len(line)+len(chunk) > maxLine:
				oversized = true
				scan(line)
				scan(chunk)
				line = nil // release the partial line
			default:
				line = append(line, chunk...)
			}
		}
		if err == bufio.ErrBufferFull {
			continue // the line continues in the next chunk
		}
		// End of a line (newline, or EOF after a final unterminated line).
		if oversized {
			skipped = skipped || hit
		} else if len(line) > 0 && bytes.Contains(line, needle) {
			fn(bytes.TrimSpace(line))
		}
		line, oversized, hit, tail = line[:0], false, false, tail[:0]
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	if skipped {
		return ErrLineTooLong
	}
	return nil
}
