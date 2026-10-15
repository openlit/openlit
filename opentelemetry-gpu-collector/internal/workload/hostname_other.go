//go:build !linux

package workload

import "os"

func openHostname(path string) (*os.File, error) {
	return os.Open(path)
}
