package drmfdinfo

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseBusyNs(t *testing.T) {
	ns, err := parseBusyNs("12345 ns")
	if err != nil || ns != 12345 {
		t.Fatalf("got %d %v", ns, err)
	}
	ns, err = parseBusyNs("99")
	if err != nil || ns != 99 {
		t.Fatalf("got %d %v", ns, err)
	}
}

func TestParseMemBytes(t *testing.T) {
	b, ok := parseMemBytes("4 MiB")
	if !ok || b != 4*1024*1024 {
		t.Fatalf("got %d %v", b, ok)
	}
	b, ok = parseMemBytes("512 KiB")
	if !ok || b != 512*1024 {
		t.Fatalf("got %d %v", b, ok)
	}
}

func TestParseFdinfoFixture(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fdinfo")
	content := `pos:	0
flags:	02100002
mnt_id:	19
ino:	123
drm-driver:	amdgpu
drm-pdev:	0000:03:00.0
drm-client-id:	42
drm-engine-gfx:	1000 ns
drm-memory-vram:	8 MiB
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	c, ok := parseFdinfo(path, 1234)
	if !ok {
		t.Fatal("expected parse ok")
	}
	if c.Driver != "amdgpu" || c.PCIAddress != "0000:03:00.0" || c.ClientID != "42" {
		t.Fatalf("unexpected client: %+v", c)
	}
	if c.EngineNs["gfx"] != 1000 {
		t.Fatalf("engine ns: %v", c.EngineNs)
	}
	if c.MemoryBy != 8*1024*1024 {
		t.Fatalf("memory: %d", c.MemoryBy)
	}
}

func TestParseFdinfoMemoryNoDoubleCount(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fdinfo")
	content := `drm-driver:	amdgpu
drm-pdev:	0000:03:00.0
drm-client-id:	1
drm-total-memory:	10 MiB
drm-memory-vram:	8 MiB
drm-resident-memory:	8 MiB
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	c, ok := parseFdinfo(path, 1)
	if !ok {
		t.Fatal("expected parse ok")
	}
	if c.MemoryBy != 10*1024*1024 {
		t.Fatalf("expected total-memory only, got %d", c.MemoryBy)
	}
}

func TestPickPrimaryEngine(t *testing.T) {
	got := pickPrimaryEngine(map[string]uint64{"video": 9, "gfx": 1})
	if got != "gfx" {
		t.Fatalf("got %s", got)
	}
}
