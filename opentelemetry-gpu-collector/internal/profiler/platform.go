package profiler

import (
	"runtime"
	"strings"
)

// Platform represents the operating system platform
type Platform string

const (
	PlatformLinux   Platform = "linux"
	PlatformWindows Platform = "windows"
	PlatformDarwin  Platform = "darwin"
)

// GetCurrentPlatform returns the current platform
func GetCurrentPlatform() Platform {
	switch strings.ToLower(runtime.GOOS) {
	case "linux":
		return PlatformLinux
	case "windows":
		return PlatformWindows
	case "darwin":
		return PlatformDarwin
	default:
		return PlatformLinux // Default to Linux
	}
}

// IsPlatformSupported checks if the current platform is supported
func IsPlatformSupported() bool {
	platform := GetCurrentPlatform()
	switch platform {
	case PlatformLinux:
		return true
	case PlatformWindows:
		// Windows support is limited to NVIDIA GPUs
		return true
	case PlatformDarwin:
		// macOS support is limited to Apple Silicon
		return true
	default:
		return false
	}
}

// GetPlatformSpecificProfiler returns the appropriate profiler for the current platform
func GetPlatformSpecificProfiler(logger *zap.Logger, maxSamples int) (Profiler, error) {
	platform := GetCurrentPlatform()
	switch platform {
	case PlatformLinux:
		// Try NVIDIA first, then AMD
		if nvidiaProfiler := NewNVIDIAProfiler(logger, maxSamples); nvidiaProfiler != nil {
			return nvidiaProfiler, nil
		}
		if amdProfiler := NewAMDProfiler(logger, maxSamples); amdProfiler != nil {
			return amdProfiler, nil
		}
	case PlatformWindows:
		// Windows only supports NVIDIA
		if nvidiaProfiler := NewNVIDIAProfiler(logger, maxSamples); nvidiaProfiler != nil {
			return nvidiaProfiler, nil
		}
	case PlatformDarwin:
		// macOS only supports Apple Silicon
		if appleProfiler := NewAppleProfiler(logger, maxSamples); appleProfiler != nil {
			return appleProfiler, nil
		}
	}
	return nil, fmt.Errorf("no supported GPU profiler found for platform %s", platform)
} 