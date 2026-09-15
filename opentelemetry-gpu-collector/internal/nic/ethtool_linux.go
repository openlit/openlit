//go:build linux

package nic

import (
	"encoding/binary"
	"fmt"
	"unsafe"

	"golang.org/x/sys/unix"
)

const (
	ethSSStats    = 1
	ethGStringLen = 32
)

// ifreqData mirrors golang.org/x/sys/unix.ifreqData for SIOCETHTOOL.
// Ifru is 24 bytes on linux amd64/arm64 (IFNAMSIZ=16 + Ifru=24 = 40 total ifreq).
type ifreqData struct {
	name [unix.IFNAMSIZ]byte
	data unsafe.Pointer
	_    [24 - unix.SizeofPtr]byte
}

// readEthtoolStats attempts SIOCETHTOOL driver stats. Returns nil, err on failure;
// callers should fall back to sysfs/gopsutil basics.
func readEthtoolStats(ifname string) (map[string]uint64, error) {
	fd, err := unix.Socket(unix.AF_INET, unix.SOCK_DGRAM, 0)
	if err != nil {
		return nil, err
	}
	defer unix.Close(fd)

	nstats, err := ethtoolStatCount(fd, ifname)
	if err != nil || nstats == 0 {
		return nil, err
	}

	names, err := ethtoolStatNames(fd, ifname, nstats)
	if err != nil {
		return nil, err
	}
	values, err := ethtoolStatValues(fd, ifname, nstats)
	if err != nil {
		return nil, err
	}

	out := make(map[string]uint64, len(names))
	for i, name := range names {
		if i >= len(values) || name == "" {
			continue
		}
		out[name] = values[i]
	}
	return out, nil
}

func ethtoolStatCount(fd int, ifname string) (uint32, error) {
	// struct ethtool_sset_info { __u32 cmd; __u32 reserved; __u64 sset_mask; __u32 data[0]; }
	buf := make([]byte, 4+4+8+4)
	binary.LittleEndian.PutUint32(buf[0:4], unix.ETHTOOL_GSSET_INFO)
	binary.LittleEndian.PutUint64(buf[8:16], 1<<ethSSStats)
	if err := ioctlEthtool(fd, ifname, buf); err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint32(buf[16:20]), nil
}

func ethtoolStatNames(fd int, ifname string, n uint32) ([]string, error) {
	dataLen := int(n) * ethGStringLen
	buf := make([]byte, 12+dataLen)
	binary.LittleEndian.PutUint32(buf[0:4], unix.ETHTOOL_GSTRINGS)
	binary.LittleEndian.PutUint32(buf[4:8], ethSSStats)
	binary.LittleEndian.PutUint32(buf[8:12], n)
	if err := ioctlEthtool(fd, ifname, buf); err != nil {
		return nil, err
	}
	out := make([]string, 0, n)
	for i := 0; i < int(n); i++ {
		start := 12 + i*ethGStringLen
		chunk := buf[start : start+ethGStringLen]
		end := 0
		for end < len(chunk) && chunk[end] != 0 {
			end++
		}
		out = append(out, string(chunk[:end]))
	}
	return out, nil
}

func ethtoolStatValues(fd int, ifname string, n uint32) ([]uint64, error) {
	buf := make([]byte, 8+int(n)*8)
	binary.LittleEndian.PutUint32(buf[0:4], unix.ETHTOOL_GSTATS)
	binary.LittleEndian.PutUint32(buf[4:8], n)
	if err := ioctlEthtool(fd, ifname, buf); err != nil {
		return nil, err
	}
	out := make([]uint64, n)
	for i := uint32(0); i < n; i++ {
		off := 8 + int(i)*8
		out[i] = binary.LittleEndian.Uint64(buf[off : off+8])
	}
	return out, nil
}

func ioctlEthtool(fd int, ifname string, data []byte) error {
	if len(ifname) >= unix.IFNAMSIZ {
		return fmt.Errorf("interface name too long: %s", ifname)
	}
	var ifr ifreqData
	copy(ifr.name[:], ifname)
	ifr.data = unsafe.Pointer(&data[0])
	_, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), uintptr(unix.SIOCETHTOOL), uintptr(unsafe.Pointer(&ifr)))
	if errno != 0 {
		return errno
	}
	return nil
}
