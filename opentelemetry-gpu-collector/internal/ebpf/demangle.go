//go:build linux

package ebpf

import (
	"github.com/ianlancetaylor/demangle"
)

func tryDemangle(name string) string {
	result, err := demangle.ToString(name)
	if err != nil {
		return name
	}
	return result
}
