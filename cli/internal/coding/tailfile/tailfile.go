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
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
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

// MaxFieldValue caps one captured field value in EachJSONLFields. Kept
// fields are small (ids, model names, usage objects); a larger value means
// the line isn't what the caller expects and is reported, not truncated.
const MaxFieldValue = 64 * 1024

const maxKeyLen = 256

// ErrFieldTooLarge reports that a kept field exceeded MaxFieldValue, so a
// rollup built from fn is incomplete.
var ErrFieldTooLarge = errors.New("tailfile: kept JSONL field exceeds MaxFieldValue")

// EachJSONLFields streams a JSONL file and, for every line that has at least
// one of the dotted `keep` paths (e.g. "message.usage"), calls fn with a
// compact JSON object holding only those fields. Everything else on the line
// is scanned and discarded, so memory stays bounded however long a line is:
// a transcript line carrying a multi-megabyte tool input costs no more than
// a short one. Paths only match object keys ("message.usage"), not array
// elements; malformed lines are skipped.
//
// Used by end-of-session rollups that must see the whole transcript (tool
// results make transcripts grow past DefaultCap within minutes, so a tail
// read undercounts). It returns any non-EOF read error, and ErrFieldTooLarge
// if a kept value had to be dropped; in both cases the caller must not treat
// what fn saw as complete. fn's slice is only valid during the call.
func EachJSONLFields(path string, keep []string, fn func(obj []byte)) error {
	f, err := os.Open(path) //nolint:gosec // path comes from the agent's own payload
	if err != nil {
		return err
	}
	defer f.Close()
	return eachJSONLFields(f, keep, fn)
}

func eachJSONLFields(src io.Reader, keep []string, fn func(obj []byte)) error {
	s := newFieldScanner(keep)
	r := bufio.NewReaderSize(src, 64*1024)
	tooLarge := false
	for {
		chunk, err := r.ReadSlice('\n')
		for _, c := range chunk {
			if c == '\n' { // valid JSONL has no raw newline inside a string
				if obj, ok := s.endLine(); ok {
					fn(obj)
				}
				tooLarge = tooLarge || s.overflow
				s.reset()
				continue
			}
			s.feed(c)
		}
		if err == bufio.ErrBufferFull {
			continue // the line continues in the next chunk
		}
		if err == io.EOF {
			if obj, ok := s.endLine(); ok { // final line without a trailing newline
				fn(obj)
			}
			tooLarge = tooLarge || s.overflow
			break
		}
		if err != nil {
			return err
		}
	}
	if tooLarge {
		return ErrFieldTooLarge
	}
	return nil
}

// fieldScanner is a byte-at-a-time JSON scanner for one line. It tracks only
// container nesting, the current key per object level, and string/escape
// state, and copies out the raw bytes of values at kept paths.
type fieldScanner struct {
	keep     map[string]bool
	maxDepth int // deepest kept path; values below it are never captured

	stack  []frame
	inStr  bool
	esc    bool
	strKey bool // the current string is an object key
	bad    bool // line is not a JSON object (or is malformed)
	opened bool // saw the line's opening '{'

	capturing bool
	capPath   string
	capDepth  int  // stack depth at which the captured value started
	capKind   byte // '"' string, '{' / '[' container, 'l' literal
	capBuf    []byte
	overflow  bool
	found     map[string][]byte
}

type frame struct {
	obj       bool
	key       []byte
	keyLong   bool
	expectKey bool
	valueSeen bool
}

func newFieldScanner(keep []string) *fieldScanner {
	s := &fieldScanner{keep: map[string]bool{}, found: map[string][]byte{}}
	for _, p := range keep {
		s.keep[p] = true
		if d := strings.Count(p, ".") + 1; d > s.maxDepth {
			s.maxDepth = d
		}
	}
	return s
}

func (s *fieldScanner) reset() {
	s.stack, s.inStr, s.esc, s.strKey, s.bad, s.opened = s.stack[:0], false, false, false, false, false
	s.capturing, s.capBuf, s.overflow = false, s.capBuf[:0], false
	clear(s.found)
}

// path of the value about to start at the current position ("" if not keepable).
func (s *fieldScanner) valuePath() string {
	if len(s.stack) == 0 || len(s.stack) > s.maxDepth {
		return ""
	}
	parts := make([]string, 0, len(s.stack))
	for _, f := range s.stack {
		if !f.obj || f.keyLong {
			return "" // array elements and over-long keys never match
		}
		parts = append(parts, string(f.key))
	}
	p := strings.Join(parts, ".")
	if !s.keep[p] {
		return ""
	}
	return p
}

// startValue is called when a value begins at the top frame.
func (s *fieldScanner) startValue(c byte, kind byte) {
	top := &s.stack[len(s.stack)-1]
	if top.valueSeen {
		return
	}
	top.valueSeen = true
	if s.capturing {
		return
	}
	if p := s.valuePath(); p != "" {
		s.capturing, s.capPath, s.capDepth, s.capKind = true, p, len(s.stack), kind
		s.capBuf = append(s.capBuf[:0], c)
	}
}

func (s *fieldScanner) appendCap(c byte) {
	if len(s.capBuf) >= MaxFieldValue {
		s.overflow = true
		return
	}
	s.capBuf = append(s.capBuf, c)
}

func (s *fieldScanner) finishCap() {
	if !s.overflow {
		s.found[s.capPath] = append([]byte(nil), s.capBuf...)
	}
	s.capturing = false
}

func (s *fieldScanner) feed(c byte) {
	if s.bad {
		return
	}
	if s.inStr {
		if s.capturing {
			s.appendCap(c)
		}
		switch {
		case s.esc:
			s.esc = false
		case c == '\\':
			s.esc = true
		case c == '"':
			s.inStr = false
			if s.strKey {
				return
			}
			if s.capturing && s.capKind == '"' && len(s.stack) == s.capDepth {
				s.finishCap()
			}
			return
		}
		if s.strKey {
			top := &s.stack[len(s.stack)-1]
			if len(top.key) < maxKeyLen {
				top.key = append(top.key, c)
			} else {
				top.keyLong = true
			}
		}
		return
	}

	// A literal (number / true / false / null) ends at the next delimiter.
	if s.capturing && s.capKind == 'l' && len(s.stack) == s.capDepth {
		switch c {
		case ',', '}', ']', ' ', '\t', '\r':
			s.finishCap()
		default:
			s.appendCap(c)
			return
		}
	}

	switch c {
	case ' ', '\t', '\r':
		if s.capturing {
			s.appendCap(c)
		}
	case '{', '[':
		if !s.opened {
			if c != '{' {
				s.bad = true
				return
			}
			s.opened = true
		} else if len(s.stack) == 0 {
			s.bad = true // content after the top-level object
			return
		} else {
			if s.capturing {
				s.appendCap(c)
			}
			s.startValue(c, c)
		}
		s.stack = append(s.stack, frame{obj: c == '{', expectKey: c == '{'})
	case '}', ']':
		if len(s.stack) == 0 {
			s.bad = true
			return
		}
		if s.capturing {
			s.appendCap(c)
		}
		s.stack = s.stack[:len(s.stack)-1]
		if s.capturing && s.capKind != 'l' && len(s.stack) == s.capDepth {
			s.finishCap()
		}
	case ':':
		if len(s.stack) == 0 || !s.stack[len(s.stack)-1].obj {
			s.bad = true
			return
		}
		if s.capturing {
			s.appendCap(c)
		}
		top := &s.stack[len(s.stack)-1]
		top.expectKey, top.valueSeen = false, false
	case ',':
		if len(s.stack) == 0 {
			s.bad = true
			return
		}
		if s.capturing {
			s.appendCap(c)
		}
		top := &s.stack[len(s.stack)-1]
		top.valueSeen = false
		if top.obj {
			top.expectKey, top.key, top.keyLong = true, top.key[:0], false
		}
	case '"':
		if len(s.stack) == 0 {
			s.bad = true
			return
		}
		s.inStr = true
		if s.capturing {
			s.appendCap(c) // opening quote of a key or a string inside the captured value
		}
		top := &s.stack[len(s.stack)-1]
		if top.obj && top.expectKey {
			s.strKey = true
			top.key, top.keyLong = top.key[:0], false
			return
		}
		s.strKey = false
		s.startValue(c, '"')
	default: // start (or continuation) of a literal
		if len(s.stack) == 0 {
			s.bad = true
			return
		}
		if s.capturing {
			s.appendCap(c)
		}
		s.startValue(c, 'l')
	}
}

// endLine returns the kept fields of a well-formed line as one compact JSON
// object, nested by path ("message.usage" -> {"message":{"usage":...}}).
func (s *fieldScanner) endLine() ([]byte, bool) {
	if s.capturing && s.capKind == 'l' && len(s.stack) == s.capDepth {
		s.finishCap()
	}
	if s.bad || !s.opened || len(s.stack) != 0 || s.inStr || len(s.found) == 0 {
		return nil, false
	}
	root := map[string]any{}
	for p, raw := range s.found {
		node := root
		parts := strings.Split(p, ".")
		for _, k := range parts[:len(parts)-1] {
			child, ok := node[k].(map[string]any)
			if !ok {
				child = map[string]any{}
				node[k] = child
			}
			node = child
		}
		node[parts[len(parts)-1]] = json.RawMessage(raw)
	}
	obj, err := json.Marshal(root)
	if err != nil {
		return nil, false
	}
	return obj, true
}
