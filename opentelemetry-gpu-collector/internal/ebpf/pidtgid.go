package ebpf

// pidFromPidTgid extracts the kernel tgid (userspace PID) from a BPF pid_tgid key.
func pidFromPidTgid(key uint64) uint32 {
	return uint32(key >> 32)
}

// stalePidTgidKeys returns pid_tgid keys whose process is no longer alive.
// alive is called at most once per distinct PID.
func stalePidTgidKeys(keys []uint64, alive func(uint32) bool) []uint64 {
	if alive == nil || len(keys) == 0 {
		return nil
	}
	checked := make(map[uint32]bool)
	var stale []uint64
	for _, key := range keys {
		pid := pidFromPidTgid(key)
		ok, seen := checked[pid]
		if !seen {
			ok = alive(pid)
			checked[pid] = ok
		}
		if !ok {
			stale = append(stale, key)
		}
	}
	return stale
}
