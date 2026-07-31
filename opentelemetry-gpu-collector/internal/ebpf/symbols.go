//go:build linux && (amd64 || arm64)

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
// by parsing ELF symbols from process memory maps.
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
	loaded  []addressRange
}

type addressRange struct {
	start uint64
	end   uint64
}

type procMapEntry struct {
	addrRange string
	start     uint64
	end       uint64
	offset    uint64
	perms     string
	path      string
}

func NewSymbolResolver(logger *slog.Logger) *SymbolResolver {
	return &SymbolResolver{
		logger: logger,
		cache:  make(map[uint32]*symbolTable),
	}
}

const maxSymbolCachePIDs = 512

// Resolve looks up the symbol name for a given PID and virtual address.
func (sr *SymbolResolver) Resolve(pid uint32, addr uint64) string {
	sr.mu.RLock()
	st := sr.cache[pid]
	if st != nil {
		if name := st.lookup(addr); name != "" {
			sr.mu.RUnlock()
			return demangleName(name)
		}
		if st.covers(addr) {
			sr.mu.RUnlock()
			return ""
		}
	}
	sr.mu.RUnlock()

	entries, mapped, ok := sr.loadSymbolsForAddress(pid, addr)
	if !ok {
		return ""
	}

	sr.mu.Lock()
	st = sr.cache[pid]
	if st == nil {
		if len(sr.cache) >= maxSymbolCachePIDs {
			// Drop an arbitrary entry; process churn is rare relative to launches.
			for cachedPID := range sr.cache {
				delete(sr.cache, cachedPID)
				break
			}
		}
		st = &symbolTable{}
		sr.cache[pid] = st
	}
	if !st.covers(addr) {
		st.entries = append(st.entries, entries...)
		st.loaded = append(st.loaded, mapped)
		sort.Slice(st.entries, func(i, j int) bool {
			return st.entries[i].addr < st.entries[j].addr
		})
	}
	name := st.lookup(addr)
	sr.mu.Unlock()

	if name == "" {
		return ""
	}
	return demangleName(name)
}

func (st *symbolTable) covers(addr uint64) bool {
	for _, r := range st.loaded {
		if addr >= r.start && addr < r.end {
			return true
		}
	}
	return false
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
	if entry.size == 0 && addr != entry.addr {
		return ""
	}

	return entry.name
}

// loadSymbolsForAddress finds the executable mapping containing addr and loads
// symbols only from that ELF image. cudaLaunchKernel's func pointer commonly
// targets a host stub in the application executable or a user extension, not
// libcudart itself.
func (sr *SymbolResolver) loadSymbolsForAddress(pid uint32, addr uint64) ([]symbolEntry, addressRange, bool) {
	mapsPath := fmt.Sprintf("/proc/%d/maps", pid)
	f, err := os.Open(mapsPath)
	if err != nil {
		sr.logger.Debug("cannot read process maps", "pid", pid, "error", err)
		return nil, addressRange{}, false
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 16*1024), 256*1024)
	for scanner.Scan() {
		mapping, ok := parseProcMapEntry(scanner.Text())
		if !ok || addr < mapping.start || addr >= mapping.end {
			continue
		}
		mapped := addressRange{start: mapping.start, end: mapping.end}
		if !strings.Contains(mapping.perms, "x") || mapping.path == "" || mapping.path[0] != '/' {
			return nil, mapped, true
		}

		// Prefer the file as seen by the target process (other mount namespaces).
		libPath := resolveMappedLib(int(pid), mapping.addrRange, mapping.path)
		if libPath == "" {
			return nil, mapped, true
		}
		return loadELFSymbols(libPath, mapping.start, mapping.offset), mapped, true
	}

	return nil, addressRange{}, false
}

func parseProcMapEntry(line string) (procMapEntry, bool) {
	fields := strings.Fields(line)
	if len(fields) < 6 {
		return procMapEntry{}, false
	}

	bounds := strings.SplitN(fields[0], "-", 2)
	if len(bounds) != 2 {
		return procMapEntry{}, false
	}
	start, err := strconv.ParseUint(bounds[0], 16, 64)
	if err != nil {
		return procMapEntry{}, false
	}
	end, err := strconv.ParseUint(bounds[1], 16, 64)
	if err != nil || end <= start {
		return procMapEntry{}, false
	}
	offset, err := strconv.ParseUint(fields[2], 16, 64)
	if err != nil {
		return procMapEntry{}, false
	}
	path := strings.Join(fields[5:], " ")
	path = strings.TrimSuffix(path, " (deleted)")
	return procMapEntry{
		addrRange: fields[0],
		start:     start,
		end:       end,
		offset:    offset,
		perms:     fields[1],
		path:      path,
	}, true
}

func loadELFSymbols(path string, mapStart, mapOffset uint64) []symbolEntry {
	f, err := elf.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	loadBias, ok := elfLoadBias(f, mapStart, mapOffset)
	if !ok {
		return nil
	}

	var entries []symbolEntry
	seen := make(map[string]struct{})

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
			key := fmt.Sprintf("%x:%s", s.Value, s.Name)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			entries = append(entries, symbolEntry{
				addr: loadBias + s.Value,
				size: s.Size,
				name: s.Name,
			})
		}
	}

	return entries
}

func elfLoadBias(f *elf.File, mapStart, mapOffset uint64) (uint64, bool) {
	pageSize := uint64(os.Getpagesize())
	alignDown := func(v uint64) uint64 {
		return v & ^(pageSize - 1)
	}
	alignUp := func(v uint64) uint64 {
		return (v + pageSize - 1) & ^(pageSize - 1)
	}

	for _, prog := range f.Progs {
		if prog.Type != elf.PT_LOAD {
			continue
		}
		segmentOffset := alignDown(prog.Off)
		segmentEnd := alignUp(prog.Off + prog.Filesz)
		if mapOffset < segmentOffset || mapOffset >= segmentEnd {
			continue
		}
		segmentVaddr := alignDown(prog.Vaddr)
		virtualAtMapping := segmentVaddr + (mapOffset - segmentOffset)
		if mapStart < virtualAtMapping {
			return 0, false
		}
		return mapStart - virtualAtMapping, true
	}

	return 0, false
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
