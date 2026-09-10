package kineto

import (
	"fmt"
	"strconv"
	"strings"
)

// TriggerMode selects duration-based vs iteration-based Kineto profiling.
type TriggerMode int

const (
	TriggerDuration TriggerMode = iota
	TriggerIteration
)

// Options mirrors PyTorch / libkineto on-demand profiler flags.
type Options struct {
	RecordShapes  bool
	ProfileMemory bool
	WithStacks    bool
	WithFlops     bool
	WithModules   bool
}

// Request describes a single on-demand Kineto profiling request.
type Request struct {
	LogFile          string
	Mode             TriggerMode
	DurationMS       uint64
	StartTimeMS      uint64 // PROFILE_START_TIME
	Iterations       int64
	IterationRoundup uint64
	Options          Options
}

// ConfigText builds a libkineto ACTIVITIES_* config string.
// Panics if ProfileMemory is set with TriggerIteration (libkineto constraint).
func (r Request) ConfigText() string {
	var durationMS *uint64
	switch r.Mode {
	case TriggerDuration:
		d := r.DurationMS
		durationMS = &d
	default:
		if r.Options.ProfileMemory {
			panic("Please only use -profile-memory with duration mode, i.e. set --duration-ms")
		}
	}

	var b strings.Builder
	b.WriteString("ACTIVITIES_LOG_FILE=")
	b.WriteString(r.LogFile)
	b.WriteByte('\n')
	b.WriteString(r.triggerConfig())
	b.WriteString(r.Options.optionsConfig(durationMS))
	return b.String()
}

func (r Request) triggerConfig() string {
	switch r.Mode {
	case TriggerIteration:
		return fmt.Sprintf(
			"PROFILE_START_ITERATION=0\nPROFILE_START_ITERATION_ROUNDUP=%d\nACTIVITIES_ITERATIONS=%d",
			r.IterationRoundup, r.Iterations,
		)
	default:
		return fmt.Sprintf(
			"PROFILE_START_TIME=%d\nACTIVITIES_DURATION_MSECS=%d",
			r.StartTimeMS, r.DurationMS,
		)
	}
}

// optionsConfig formats PROFILE_* option lines, including a leading newline.
func (o Options) optionsConfig(durationMS *uint64) string {
	var mem string
	if o.ProfileMemory {
		if durationMS == nil {
			panic("Duration must be set when profiling memory!")
		}
		mem = fmt.Sprintf(
			"\nPROFILE_PROFILE_MEMORY=true\nPROFILE_MEMORY=true\nPROFILE_MEMORY_DURATION_MSECS=%d",
			*durationMS,
		)
	}
	return fmt.Sprintf(
		"\nPROFILE_REPORT_INPUT_SHAPES=%s%s\nPROFILE_WITH_STACK=%s\nPROFILE_WITH_FLOPS=%s\nPROFILE_WITH_MODULES=%s",
		strconv.FormatBool(o.RecordShapes),
		mem,
		strconv.FormatBool(o.WithStacks),
		strconv.FormatBool(o.WithFlops),
		strconv.FormatBool(o.WithModules),
	)
}

// TracePathForPID rewrites a base log file path with a per-PID suffix:
// "foo.json" → "foo_<pid>.json".
func TracePathForPID(logFile string, pid int) string {
	if strings.HasSuffix(logFile, ".json") {
		return strings.TrimSuffix(logFile, ".json") + fmt.Sprintf("_%d.json", pid)
	}
	return fmt.Sprintf("%s_%d", logFile, pid)
}

// RewriteLogFile returns config with ACTIVITIES_LOG_FILE replaced by path.
func RewriteLogFile(config, path string) string {
	lines := strings.Split(config, "\n")
	for i, line := range lines {
		if strings.HasPrefix(line, "ACTIVITIES_LOG_FILE=") {
			lines[i] = "ACTIVITIES_LOG_FILE=" + path
			break
		}
	}
	return strings.Join(lines, "\n")
}
