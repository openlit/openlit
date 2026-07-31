//go:build linux && (amd64 || arm64)

package ebpf

import (
	"debug/elf"
	"io"
	"log/slog"
	"testing"
)

func TestParseProcMapEntry(t *testing.T) {
	line := "5d21d95ed000-5d21d95ef000 r-xp 00002000 103:02 289296 /opt/gpu demo (deleted)"
	got, ok := parseProcMapEntry(line)
	if !ok {
		t.Fatal("parseProcMapEntry returned false")
	}
	if got.start != 0x5d21d95ed000 || got.end != 0x5d21d95ef000 {
		t.Fatalf("range = %#x-%#x", got.start, got.end)
	}
	if got.offset != 0x2000 {
		t.Fatalf("offset = %#x, want 0x2000", got.offset)
	}
	if got.perms != "r-xp" {
		t.Fatalf("perms = %q", got.perms)
	}
	if got.path != "/opt/gpu demo" {
		t.Fatalf("path = %q", got.path)
	}
}

func TestELFLoadBiasPIEAndExecutable(t *testing.T) {
	const (
		mapOffset = 0x2000
		imageBase = 0x5d21d95eb000
	)

	pie := &elf.File{Progs: []*elf.Prog{{
		ProgHeader: elf.ProgHeader{
			Type:   elf.PT_LOAD,
			Off:    mapOffset,
			Vaddr:  mapOffset,
			Filesz: 0x2000,
		},
	}}}
	bias, ok := elfLoadBias(pie, imageBase+mapOffset, mapOffset)
	if !ok || bias != imageBase {
		t.Fatalf("PIE load bias = %#x, %v; want %#x, true", bias, ok, imageBase)
	}

	executable := &elf.File{Progs: []*elf.Prog{{
		ProgHeader: elf.ProgHeader{
			Type:   elf.PT_LOAD,
			Off:    mapOffset,
			Vaddr:  0x402000,
			Filesz: 0x2000,
		},
	}}}
	bias, ok = elfLoadBias(executable, 0x402000, mapOffset)
	if !ok || bias != 0 {
		t.Fatalf("ET_EXEC-style load bias = %#x, %v; want 0, true", bias, ok)
	}
}

func TestELFLoadBiasRejectsInvalidMappings(t *testing.T) {
	file := &elf.File{Progs: []*elf.Prog{{
		ProgHeader: elf.ProgHeader{
			Type:   elf.PT_LOAD,
			Off:    0x2000,
			Vaddr:  0x402000,
			Filesz: 0x2000,
		},
	}}}

	tests := []struct {
		name      string
		mapStart  uint64
		mapOffset uint64
	}{
		{
			name:      "offset outside load segments",
			mapStart:  0x405000,
			mapOffset: 0x5000,
		},
		{
			name:      "mapping starts below segment address",
			mapStart:  0x401000,
			mapOffset: 0x2000,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if bias, ok := elfLoadBias(file, tt.mapStart, tt.mapOffset); ok {
				t.Fatalf("elfLoadBias() = %#x, true; want false", bias)
			}
		})
	}
}

func TestSymbolTableLookupAndCoveredMiss(t *testing.T) {
	st := &symbolTable{
		entries: []symbolEntry{
			{addr: 0x1100, size: 0x20, name: "sized"},
			{addr: 0x1200, size: 0, name: "exact-only"},
		},
		loaded: []addressRange{{start: 0x1000, end: 0x2000}},
	}

	if got := st.lookup(0x1110); got != "sized" {
		t.Fatalf("lookup sized = %q", got)
	}
	if got := st.lookup(0x1200); got != "exact-only" {
		t.Fatalf("lookup exact = %q", got)
	}
	if got := st.lookup(0x1201); got != "" {
		t.Fatalf("zero-size symbol matched a range: %q", got)
	}
	if !st.covers(0x1800) || st.covers(0x2000) {
		t.Fatal("address range coverage is incorrect")
	}
}

func TestResolverMissDoesNotReturnASLRAddress(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	resolver := NewSymbolResolver(logger)
	if got := resolver.Resolve(^uint32(0), 0xdeadbeef); got != "" {
		t.Fatalf("Resolve miss = %q, want empty stable fallback", got)
	}
}
