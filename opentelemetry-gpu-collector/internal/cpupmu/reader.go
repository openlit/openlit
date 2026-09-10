package cpupmu

import "log/slog"

// UnavailableReader is a no-op Reader used when PMU cannot be opened.
type UnavailableReader struct{}

func (UnavailableReader) Available() bool         { return false }
func (UnavailableReader) Read() ([]Sample, error) { return nil, nil }
func (UnavailableReader) Close() error            { return nil }

// FakeReader is a test double with fixed samples.
type FakeReader struct {
	Samples   []Sample
	Avail     bool
	ReadErr   error
	CloseErr  error
	ReadCalls int
}

func (f *FakeReader) Available() bool { return f.Avail }

func (f *FakeReader) Read() ([]Sample, error) {
	f.ReadCalls++
	if f.ReadErr != nil {
		return nil, f.ReadErr
	}
	out := make([]Sample, len(f.Samples))
	copy(out, f.Samples)
	return out, nil
}

func (f *FakeReader) Close() error { return f.CloseErr }

// multiReader merges core and uncore readers.
type multiReader struct {
	parts []Reader
}

func (m *multiReader) Available() bool {
	for _, p := range m.parts {
		if p != nil && p.Available() {
			return true
		}
	}
	return false
}

func (m *multiReader) Read() ([]Sample, error) {
	var out []Sample
	for _, p := range m.parts {
		if p == nil || !p.Available() {
			continue
		}
		s, err := p.Read()
		if err != nil {
			return out, err
		}
		out = append(out, s...)
	}
	return out, nil
}

func (m *multiReader) Close() error {
	var first error
	for _, p := range m.parts {
		if p == nil {
			continue
		}
		if err := p.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// NewReader opens platform PMU events for the given event name list.
func NewReader(events []string, logger *slog.Logger) Reader {
	if logger == nil {
		logger = slog.Default()
	}
	core, wantUncore := resolveEvents(events)
	var parts []Reader
	if len(core) > 0 {
		parts = append(parts, newPlatformReader(core, logger))
	}
	if wantUncore {
		parts = append(parts, newUncoreReader(logger))
	}
	if len(parts) == 0 {
		logger.Warn("no supported PMU events resolved from config")
		return &UnavailableReader{}
	}
	if len(parts) == 1 {
		return parts[0]
	}
	return &multiReader{parts: parts}
}
