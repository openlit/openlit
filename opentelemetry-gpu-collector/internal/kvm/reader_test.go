package kvm

import (
	"os"
	"path/filepath"
	"testing"
)

func writeUint(t *testing.T, path, value string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(value+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestReadDirAggregatesRootAndVM(t *testing.T) {
	root := t.TempDir()
	writeUint(t, filepath.Join(root, "exits"), "100")
	writeUint(t, filepath.Join(root, "halt_exits"), "10")
	writeUint(t, filepath.Join(root, "io_exits"), "20")
	writeUint(t, filepath.Join(root, "mmio_exits"), "30")
	writeUint(t, filepath.Join(root, "irq_exits"), "5")
	writeUint(t, filepath.Join(root, "irq_window_exits"), "6")
	writeUint(t, filepath.Join(root, "signal_exits"), "7")
	writeUint(t, filepath.Join(root, "insn_emulation"), "50")
	writeUint(t, filepath.Join(root, "insn_emulation_fail"), "2")
	writeUint(t, filepath.Join(root, "hypercalls"), "9")
	writeUint(t, filepath.Join(root, "halt_successful_poll"), "11")
	writeUint(t, filepath.Join(root, "halt_attempted_poll"), "12")
	writeUint(t, filepath.Join(root, "halt_wakeup"), "13")
	writeUint(t, filepath.Join(root, "tlb_flush"), "14")
	writeUint(t, filepath.Join(root, "remote_tlb_flush"), "15")
	writeUint(t, filepath.Join(root, "mmu_cache_miss"), "16")
	writeUint(t, filepath.Join(root, "mmu_flooded"), "17")
	writeUint(t, filepath.Join(root, "pages_4k"), "1000")
	writeUint(t, filepath.Join(root, "pages_2m"), "200")
	writeUint(t, filepath.Join(root, "pages_1g"), "3")

	// Per-VM directory contributes additional totals.
	vm := filepath.Join(root, "1234-0")
	writeUint(t, filepath.Join(vm, "exits"), "40")
	writeUint(t, filepath.Join(vm, "hypercalls"), "1")
	writeUint(t, filepath.Join(vm, "pages_4k"), "10")

	snap, err := ReadDir(root)
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}

	if got, want := snap.Exits["total"], uint64(140); got != want {
		t.Errorf("exits total = %d, want %d", got, want)
	}
	if got, want := snap.Exits["halt"], uint64(10); got != want {
		t.Errorf("exits halt = %d, want %d", got, want)
	}
	if got, want := snap.EmulatedInstructions["ok"], uint64(50); got != want {
		t.Errorf("emulated ok = %d, want %d", got, want)
	}
	if got, want := snap.EmulatedInstructions["failed"], uint64(2); got != want {
		t.Errorf("emulated failed = %d, want %d", got, want)
	}
	if got, want := snap.Hypercalls, uint64(10); got != want {
		t.Errorf("hypercalls = %d, want %d", got, want)
	}
	if got, want := snap.HaltPoll["successful"], uint64(11); got != want {
		t.Errorf("halt_poll successful = %d, want %d", got, want)
	}
	if got, want := snap.TLBFlushes["local"], uint64(14); got != want {
		t.Errorf("tlb local = %d, want %d", got, want)
	}
	if got, want := snap.TLBFlushes["remote"], uint64(15); got != want {
		t.Errorf("tlb remote = %d, want %d", got, want)
	}
	if got, want := snap.MMUEvents["cache_miss"], uint64(16); got != want {
		t.Errorf("mmu cache_miss = %d, want %d", got, want)
	}
	if got, want := snap.Pages["4k"], uint64(1010); got != want {
		t.Errorf("pages 4k = %d, want %d", got, want)
	}
	if got, want := snap.Pages["2m"], uint64(200); got != want {
		t.Errorf("pages 2m = %d, want %d", got, want)
	}
	if got, want := snap.Pages["1g"], uint64(3); got != want {
		t.Errorf("pages 1g = %d, want %d", got, want)
	}
}

func TestReadDirMissing(t *testing.T) {
	if _, err := ReadDir(filepath.Join(t.TempDir(), "no-such")); err == nil {
		t.Fatal("expected error for missing dir")
	}
}

func TestNewCollectorSoftFailMissing(t *testing.T) {
	c, err := newCollector(nilProvider(t), discardLogger(), filepath.Join(t.TempDir(), "missing"))
	if err != nil {
		t.Fatalf("newCollector() error = %v", err)
	}
	if c.root != "" {
		t.Errorf("expected empty root on soft-fail, got %q", c.root)
	}
	c.Close()
}

func TestNewCollectorFromFixture(t *testing.T) {
	if !platformKVMSupported() {
		t.Skip("KVM collector registration only on Linux")
	}
	root := t.TempDir()
	writeUint(t, filepath.Join(root, "exits"), "42")
	writeUint(t, filepath.Join(root, "hypercalls"), "1")

	c, err := newCollector(nilProvider(t), discardLogger(), root)
	if err != nil {
		t.Fatalf("newCollector() error = %v", err)
	}
	defer c.Close()
	if c.root != root {
		t.Errorf("root = %q, want %q", c.root, root)
	}
}
