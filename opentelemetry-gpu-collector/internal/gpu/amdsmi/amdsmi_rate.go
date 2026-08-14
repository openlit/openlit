package amdsmi

// XGMIRateBytesPerSec converts cumulative KB deltas to By/s.
func XGMIRateBytesPerSec(prevReadKB, prevWriteKB, curReadKB, curWriteKB uint64, dtSec float64) (rx, tx float64, ok bool) {
	if dtSec <= 0 || curReadKB < prevReadKB || curWriteKB < prevWriteKB {
		return 0, 0, false
	}
	return float64(curReadKB-prevReadKB) * 1024.0 / dtSec,
		float64(curWriteKB-prevWriteKB) * 1024.0 / dtSec,
		true
}
