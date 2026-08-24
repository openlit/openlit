//go:build linux

package hostmetrics

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// readPagingCounters returns major/minor page faults and page-in/page-out
// operation counts from /proc/vmstat. ok is false when the file is missing.
func readPagingCounters() (major, minor, pageIn, pageOut uint64, ok bool) {
	f, err := os.Open("/proc/vmstat")
	if err != nil {
		return 0, 0, 0, 0, false
	}
	defer f.Close()

	var pgfault, pgmajfault, pswpin, pswpout uint64
	var haveFault, haveMaj, haveIn, haveOut bool

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		v, err := strconv.ParseUint(fields[1], 10, 63)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "pgfault":
			pgfault = v
			haveFault = true
		case "pgmajfault":
			pgmajfault = v
			haveMaj = true
		case "pswpin":
			pswpin = v
			haveIn = true
		case "pswpout":
			pswpout = v
			haveOut = true
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, 0, 0, 0, false
	}
	if !haveFault && !haveMaj && !haveIn && !haveOut {
		return 0, 0, 0, 0, false
	}

	major = pgmajfault
	if pgfault >= pgmajfault {
		minor = pgfault - pgmajfault
	}
	return major, minor, pswpin, pswpout, true
}
