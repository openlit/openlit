package cpupmu

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveEventsUncoreAliases(t *testing.T) {
	_, u1 := resolveEvents([]string{"uncore"})
	_, u2 := resolveEvents([]string{"memory.io"})
	if !u1 || !u2 {
		t.Fatal("expected uncore aliases to request uncore")
	}
	core, u3 := resolveEvents([]string{"instructions"})
	if u3 || len(core) != 1 {
		t.Fatalf("core-only: core=%v uncore=%v", core, u3)
	}
}

func TestReadUncoreEventConfig(t *testing.T) {
	dir := t.TempDir()
	events := filepath.Join(dir, "events")
	if err := os.MkdirAll(events, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(events, "cas_count_read"), []byte("event=0x04\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, ok := readUncoreEventConfig(dir, "cas_count_read")
	if !ok || cfg != 0x04 {
		t.Fatalf("cfg=%#x ok=%v", cfg, ok)
	}
	if err := os.WriteFile(filepath.Join(events, "cas_count_write"), []byte("event=0x4,umask=0x3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, ok = readUncoreEventConfig(dir, "cas_count_write")
	if !ok || cfg != (0x4|(0x3<<8)) {
		t.Fatalf("cfg=%#x ok=%v", cfg, ok)
	}
}

func TestParseCPUMask(t *testing.T) {
	got := parseCPUMask("0,2-3")
	want := []int{0, 2, 3}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
}

func TestDiscoverUncoreIMCs(t *testing.T) {
	root := t.TempDir()
	dev := filepath.Join(root, "uncore_imc_0")
	if err := os.MkdirAll(filepath.Join(dev, "events"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dev, "type"), []byte("18\n"), 0o644)
	_ = os.WriteFile(filepath.Join(dev, "cpumask"), []byte("0\n"), 0o644)
	_ = os.MkdirAll(filepath.Join(root, "uncore_imc_free_running_0"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "uncore_imc_free_running_0", "type"), []byte("19\n"), 0o644)

	devs := discoverUncoreIMCs(root)
	if len(devs) != 1 || devs[0].name != "uncore_imc_0" || devs[0].pmuType != 18 {
		t.Fatalf("devs=%+v", devs)
	}
}
