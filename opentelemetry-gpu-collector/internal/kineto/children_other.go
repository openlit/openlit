//go:build !linux

package kineto

func defaultChildrenOf(pid int) []int {
	return nil
}
