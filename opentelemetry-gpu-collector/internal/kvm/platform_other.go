//go:build !linux

package kvm

func platformKVMSupported() bool { return false }
