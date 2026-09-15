package hostmetrics

import (
	"bufio"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
)

// InterruptStat is one IRQ line from /proc/interrupts.
type InterruptStat struct {
	Name    string   // IRQ number or named interrupt (e.g. "NMI")
	Info    string   // type/info field for numbered IRQs
	Devices string   // device list
	PerCPU  []uint64 // counts per logical CPU
}

// Total returns the sum of per-CPU counts.
func (s InterruptStat) Total() uint64 {
	var sum uint64
	for _, v := range s.PerCPU {
		sum += v
	}
	return sum
}

// DisplayName prefers the last device token when present, else info, else the IRQ name.
func (s InterruptStat) DisplayName() string {
	if s.Devices != "" {
		fields := strings.Fields(s.Devices)
		return fields[len(fields)-1]
	}
	if s.Info != "" {
		return s.Info
	}
	return s.Name
}

// ParseInterrupts parses /proc/interrupts content.
func ParseInterrupts(r io.Reader) ([]InterruptStat, error) {
	scanner := bufio.NewScanner(r)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("interrupts empty")
	}
	cpuNum := len(strings.Fields(scanner.Text()))
	if cpuNum == 0 {
		return nil, fmt.Errorf("interrupts missing CPU header")
	}

	var out []InterruptStat
	for scanner.Scan() {
		line := scanner.Text()
		group := strings.SplitN(line, ":", 2)
		if len(group) < 2 {
			continue
		}
		parts := strings.Fields(group[1])
		if len(parts) < cpuNum {
			continue // ERR/MIS lines often lack per-CPU columns
		}

		name := strings.TrimSpace(group[0])
		stat := InterruptStat{
			Name:   name,
			PerCPU: make([]uint64, cpuNum),
		}
		for i := 0; i < cpuNum; i++ {
			v, err := strconv.ParseUint(parts[i], 10, 63)
			if err != nil {
				return nil, fmt.Errorf("interrupt %q cpu %d: %w", name, i, err)
			}
			stat.PerCPU[i] = v
		}
		if _, err := strconv.Atoi(name); err == nil {
			if len(parts) > cpuNum {
				stat.Info = parts[cpuNum]
			}
			if len(parts) > cpuNum+1 {
				stat.Devices = strings.Join(parts[cpuNum+1:], " ")
			}
		} else if len(parts) > cpuNum {
			stat.Info = strings.Join(parts[cpuNum:], " ")
		}
		out = append(out, stat)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// uint64ToInt64 converts v to int64 when it fits. OTel int64 instruments cannot
// represent values above math.MaxInt64.
func uint64ToInt64(v uint64) (int64, bool) {
	if v > math.MaxInt64 {
		return 0, false
	}
	return int64(v), true
}
