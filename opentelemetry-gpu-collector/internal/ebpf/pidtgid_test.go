package ebpf

import "testing"

func TestPidFromPidTgid(t *testing.T) {
	key := uint64(42)<<32 | uint64(7)
	if got := pidFromPidTgid(key); got != 42 {
		t.Fatalf("pidFromPidTgid(%#x) = %d, want 42", key, got)
	}
}

func TestStalePidTgidKeysDropsDeadPID(t *testing.T) {
	live := uint64(10)<<32 | uint64(11)
	deadMain := uint64(20)<<32 | uint64(20)
	deadThread := uint64(20)<<32 | uint64(21)
	aliveCalls := map[uint32]int{}
	stale := stalePidTgidKeys([]uint64{live, deadMain, deadThread}, func(pid uint32) bool {
		aliveCalls[pid]++
		return pid == 10
	})
	if len(stale) != 2 || stale[0] != deadMain || stale[1] != deadThread {
		t.Fatalf("stale = %v, want [%d %d]", stale, deadMain, deadThread)
	}
	if aliveCalls[10] != 1 || aliveCalls[20] != 1 {
		t.Fatalf("alive calls = %v, want one per PID", aliveCalls)
	}
}

func TestStalePidTgidKeysNilAlive(t *testing.T) {
	if stalePidTgidKeys([]uint64{1}, nil) != nil {
		t.Fatal("nil alive should skip cleanup")
	}
}
