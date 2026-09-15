package kvm

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Snapshot holds aggregated KVM debugfs counters.
type Snapshot struct {
	Exits                 map[string]uint64 // system.kvm.exit.type -> count
	EmulatedInstructions  map[string]uint64 // result -> count
	Hypercalls            uint64
	HaltPoll              map[string]uint64 // result -> count
	TLBFlushes            map[string]uint64 // scope -> count
	MMUEvents             map[string]uint64 // type -> count
	Pages                 map[string]uint64 // system.kvm.page.size -> count
}

// fileMapping maps debugfs filenames to (metric group, attribute value).
var fileMapping = map[string]struct {
	group string
	attr  string
}{
	"exits":                {"exits", "total"},
	"halt_exits":           {"exits", "halt"},
	"io_exits":             {"exits", "io"},
	"mmio_exits":           {"exits", "mmio"},
	"irq_exits":             {"exits", "irq"},
	"irq_window_exits":     {"exits", "irq_window"},
	"signal_exits":         {"exits", "signal"},
	"insn_emulation":       {"emulated", "ok"},
	"insn_emulation_fail":  {"emulated", "failed"},
	"hypercalls":           {"hypercalls", ""},
	"halt_successful_poll": {"halt_poll", "successful"},
	"halt_attempted_poll":  {"halt_poll", "attempted"},
	"halt_wakeup":          {"halt_poll", "wakeup"},
	"tlb_flush":            {"tlb", "local"},
	"remote_tlb_flush":     {"tlb", "remote"},
	"mmu_cache_miss":       {"mmu", "cache_miss"},
	"mmu_flooded":          {"mmu", "flooded"},
	"pages_4k":             {"pages", "4k"},
	"pages_2m":             {"pages", "2m"},
	"pages_1g":             {"pages", "1g"},
}

// ReadDir aggregates known KVM stats from a debugfs kvm directory (or fixture).
// Values from the root and from VM subdirectories (name containing '-') are summed.
func ReadDir(root string) (*Snapshot, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}

	snap := &Snapshot{
		Exits:                map[string]uint64{},
		EmulatedInstructions: map[string]uint64{},
		HaltPoll:             map[string]uint64{},
		TLBFlushes:           map[string]uint64{},
		MMUEvents:            map[string]uint64{},
		Pages:                map[string]uint64{},
	}

	// First pass: top-level files.
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if err := accumulateFile(snap, filepath.Join(root, e.Name()), e.Name()); err != nil {
			return nil, err
		}
	}

	// Second pass: per-VM directories (e.g. "1234-0").
	for _, e := range entries {
		if !e.IsDir() || !strings.Contains(e.Name(), "-") {
			continue
		}
		vmDir := filepath.Join(root, e.Name())
		vmEntries, err := os.ReadDir(vmDir)
		if err != nil {
			continue
		}
		for _, ve := range vmEntries {
			if ve.IsDir() {
				continue
			}
			if err := accumulateFile(snap, filepath.Join(vmDir, ve.Name()), ve.Name()); err != nil {
				return nil, err
			}
		}
	}

	return snap, nil
}

func accumulateFile(snap *Snapshot, path, name string) error {
	m, ok := fileMapping[name]
	if !ok {
		return nil
	}
	v, err := readUintFile(path)
	if err != nil {
		// Soft-skip unreadable individual files.
		if os.IsNotExist(err) {
			return nil
		}
		// Permission / transient errors: skip file.
		return nil
	}
	switch m.group {
	case "exits":
		snap.Exits[m.attr] += v
	case "emulated":
		snap.EmulatedInstructions[m.attr] += v
	case "hypercalls":
		snap.Hypercalls += v
	case "halt_poll":
		snap.HaltPoll[m.attr] += v
	case "tlb":
		snap.TLBFlushes[m.attr] += v
	case "mmu":
		snap.MMUEvents[m.attr] += v
	case "pages":
		snap.Pages[m.attr] += v
	}
	return nil
}

func readUintFile(path string) (uint64, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return 0, err
		}
		return 0, fmt.Errorf("empty file %s", path)
	}
	return strconv.ParseUint(strings.TrimSpace(scanner.Text()), 10, 64)
}
