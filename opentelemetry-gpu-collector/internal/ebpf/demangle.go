//go:build linux && (amd64 || arm64)

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
