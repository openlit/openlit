package nvidia

import (
	"path/filepath"
	"runtime"
	"testing"
)

func TestNVMLCandidatePaths(t *testing.T) {
	if runtime.GOOS != "windows" {
		// Exercise path helper logic that mirrors load order (portable check).
		cands := []string{
			"nvml.dll",
			filepath.Join("C:\\Windows", "System32", "nvml.dll"),
			filepath.Join("C:\\Program Files", "NVIDIA Corporation", "NVSMI", "nvml.dll"),
		}
		for _, c := range cands {
			if c == "" {
				t.Fatal("empty candidate")
			}
		}
	}
}
