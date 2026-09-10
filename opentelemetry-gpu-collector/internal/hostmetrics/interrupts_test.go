package hostmetrics

import (
	"strings"
	"testing"
)

const sampleInterrupts = `           CPU0       CPU1       CPU2       CPU3
  0:         46          0          0          0   IO-APIC   2-edge      timer
  1:          9          0          0          0   IO-APIC   1-edge      i8042
  8:          1          0          0          0   IO-APIC   8-edge      rtc0
  9:          0          0          0          0   IO-APIC   9-fasteoi   acpi
 24:     150234      12001       8000       1001   PCI-MSI 524288-edge      eth0
NMI:         12         14         11         13   Non-maskable interrupts
LOC:    1234567    2345678    3456789    4567890   Local timer interrupts
ERR:          0
MIS:          0
`

func TestParseInterrupts(t *testing.T) {
	stats, err := ParseInterrupts(strings.NewReader(sampleInterrupts))
	if err != nil {
		t.Fatalf("ParseInterrupts() error = %v", err)
	}

	byName := map[string]InterruptStat{}
	for _, s := range stats {
		byName[s.Name] = s
	}

	eth, ok := byName["24"]
	if !ok {
		t.Fatal("expected IRQ 24")
	}
	if eth.Devices != "524288-edge eth0" {
		t.Errorf("IRQ 24 devices = %q, want 524288-edge eth0", eth.Devices)
	}
	if eth.Info != "PCI-MSI" {
		t.Errorf("IRQ 24 info = %q, want PCI-MSI", eth.Info)
	}
	if got, want := eth.Total(), uint64(150234+12001+8000+1001); got != want {
		t.Errorf("IRQ 24 total = %d, want %d", got, want)
	}
	if eth.DisplayName() != "eth0" {
		t.Errorf("DisplayName() = %q, want eth0", eth.DisplayName())
	}
	if len(eth.PerCPU) != 4 || eth.PerCPU[0] != 150234 {
		t.Errorf("IRQ 24 PerCPU = %v", eth.PerCPU)
	}

	nmi, ok := byName["NMI"]
	if !ok {
		t.Fatal("expected NMI")
	}
	if nmi.DisplayName() == "" {
		t.Error("NMI DisplayName empty")
	}
	if got, want := nmi.Total(), uint64(12+14+11+13); got != want {
		t.Errorf("NMI total = %d, want %d", got, want)
	}

	// ERR/MIS lack full per-CPU columns and should be skipped.
	if _, ok := byName["ERR"]; ok {
		t.Error("ERR should be skipped")
	}
	if _, ok := byName["MIS"]; ok {
		t.Error("MIS should be skipped")
	}
}

func TestParseInterruptsEmpty(t *testing.T) {
	if _, err := ParseInterrupts(strings.NewReader("")); err == nil {
		t.Fatal("expected error for empty input")
	}
}

func TestUint64ToInt64(t *testing.T) {
	n, ok := uint64ToInt64(42)
	if !ok || n != 42 {
		t.Fatalf("got %d ok=%v", n, ok)
	}
	if _, ok := uint64ToInt64(^uint64(0)); ok {
		t.Fatal("max uint64 should not fit in int64")
	}
}
