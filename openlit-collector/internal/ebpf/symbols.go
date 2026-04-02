//go:build linux

package ebpf

import (
	"bufio"
	"debug/elf"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// SymbolResolver maps kernel function addresses to human-readable names
// by parsing ELF symbols from process memory maps. Adapted from OBI v0.4.1.
type SymbolResolver struct {
	logger *slog.Logger
	mu     sync.RWMutex
	// pid -> sorted symbol table
	cache map[uint32]*symbolTable
}

type symbolEntry struct {
	addr uint64
	size uint64
	name string
}

type symbolTable struct {
	entries []symbolEntry
	base    uint64
}

func NewSymbolResolver(logger *slog.Logger) *SymbolResolver {
	return &SymbolResolver{
		logger: logger,
		cache:  make(map[uint32]*symbolTable),
	}
}

// Resolve looks up the symbol name for a given PID and virtual address.
func (sr *SymbolResolver) Resolve(pid uint32, addr uint64) string {
	sr.mu.RLock()
	st, ok := sr.cache[pid]
	sr.mu.RUnlock()

	if !ok {
		st = sr.loadSymbols(pid)
		sr.mu.Lock()
		sr.cache[pid] = st
		sr.mu.Unlock()
	}

	if st == nil {
		return fmt.Sprintf("0x%x", addr)
	}

	name := st.lookup(addr)
	if name == "" {
		return fmt.Sprintf("0x%x", addr)
	}

	return demangleName(name)
}

func (st *symbolTable) lookup(addr uint64) string {
	if len(st.entries) == 0 {
		return ""
	}

	// Binary search for the largest entry.addr <= addr
	idx := sort.Search(len(st.entries), func(i int) bool {
		return st.entries[i].addr > addr
	}) - 1

	if idx < 0 {
		return ""
	}

	entry := st.entries[idx]
	if entry.size > 0 && addr >= entry.addr+entry.size {
		return ""
	}

	return entry.name
}

// loadSymbols parses /proc/<pid>/maps to find CUDA-relevant libraries
// and loads their ELF symbol tables.
func (sr *SymbolResolver) loadSymbols(pid uint32) *symbolTable {
	mapsPath := fmt.Sprintf("/proc/%d/maps", pid)
	f, err := os.Open(mapsPath)
	if err != nil {
		sr.logger.Debug("cannot read process maps", "pid", pid, "error", err)
		return nil
	}
	defer f.Close()

	st := &symbolTable{}
	seen := make(map[string]bool)

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}

		path := fields[5]
		if !isCUDARelevant(path) || seen[path] {
			continue
		}
		seen[path] = true

		baseAddr := parseMapBase(fields[0])
		symbols := loadELFSymbols(path)
		for _, sym := range symbols {
			st.entries = append(st.entries, symbolEntry{
				addr: baseAddr + sym.addr,
				size: sym.size,
				name: sym.name,
			})
		}
	}

	sort.Slice(st.entries, func(i, j int) bool {
		return st.entries[i].addr < st.entries[j].addr
	})

	return st
}

func isCUDARelevant(path string) bool {
	if path == "" || path[0] != '/' {
		return false
	}
	base := strings.ToLower(path)
	return strings.Contains(base, "libcudart") ||
		strings.Contains(base, "libtorch_cuda") ||
		strings.Contains(base, "vllm") ||
		strings.Contains(base, "ggml")
}

func parseMapBase(addrRange string) uint64 {
	parts := strings.Split(addrRange, "-")
	if len(parts) < 1 {
		return 0
	}
	v, _ := strconv.ParseUint(parts[0], 16, 64)
	return v
}

func loadELFSymbols(path string) []symbolEntry {
	f, err := elf.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var entries []symbolEntry

	// Try .symtab first, then .dynsym
	for _, loader := range []func() ([]elf.Symbol, error){f.Symbols, f.DynamicSymbols} {
		syms, err := loader()
		if err != nil {
			continue
		}
		for _, s := range syms {
			if s.Value == 0 || s.Name == "" {
				continue
			}
			if elf.ST_TYPE(s.Info) != elf.STT_FUNC {
				continue
			}
			entries = append(entries, symbolEntry{
				addr: s.Value,
				size: s.Size,
				name: s.Name,
			})
		}
	}

	return entries
}

// demangleName attempts to demangle a C++ mangled name.
// Falls back to the original name if demangling fails.
func demangleName(name string) string {
	if !strings.HasPrefix(name, "_Z") {
		return name
	}
	// Simple demangling: use the ianlancetaylor/demangle package if available,
	// otherwise return as-is. The import is in a separate file to keep build flexibility.
	return tryDemangle(name)
}
