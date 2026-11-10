//go:build linux

package workload

import (
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

// openHostname opens path without following a final symlink and without blocking
// on a FIFO. /proc/<pid>/root is an intermediate symlink and is still followed.
func openHostname(path string) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NONBLOCK|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	var st unix.Stat_t
	if err := unix.Fstat(fd, &st); err != nil {
		unix.Close(fd)
		return nil, err
	}
	if st.Mode&unix.S_IFMT != unix.S_IFREG {
		unix.Close(fd)
		return nil, fmt.Errorf("hostname is not a regular file")
	}
	return os.NewFile(uintptr(fd), path), nil
}
