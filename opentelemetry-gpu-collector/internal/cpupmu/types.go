package cpupmu

// Sample is one scaled PMU counter reading.
type Sample struct {
	Name  string
	Value uint64
	// Optional attributes for cache/branch/tlb events.
	Attrs map[string]string
}

// Reader reads hardware PMU counters. Implementations must be safe for
// concurrent Close while Read may be in flight (best-effort).
type Reader interface {
	// Available reports whether any events were successfully opened.
	Available() bool
	// Read returns cumulative scaled counter values.
	Read() ([]Sample, error)
	Close() error
}

// EventSpec describes a requested hardware event.
type EventSpec struct {
	Name  string
	Attrs map[string]string
}
