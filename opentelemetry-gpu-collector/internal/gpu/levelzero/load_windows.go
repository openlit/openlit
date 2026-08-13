//go:build windows

package levelzero

import (
	"fmt"
	"os"
	"syscall"

	"github.com/ebitengine/purego"
	"golang.org/x/sys/windows"
)

// Init loads Level Zero on Windows via ze_loader.dll.
func Init() error {
	once.Do(func() {
		h, err := windows.LoadLibrary("ze_loader.dll")
		if err != nil {
			errL = fmt.Errorf("LoadLibrary ze_loader.dll: %w", err)
			return
		}
		nl := &lib{}
		bind := func(name string, fptr any) {
			addr, err := windows.GetProcAddress(h, name)
			if err != nil {
				return
			}
			purego.RegisterFunc(fptr, uintptr(addr))
		}
		bind("zeInit", &nl.zeInit)
		bind("zeDriverGet", &nl.zeDriverGet)
		bind("zeDeviceGet", &nl.zeDeviceGet)
		bind("zesInit", &nl.zesInit)
		bind("zesDeviceEnumTemperatureSensors", &nl.zesDeviceEnumTemperatureSensors)
		bind("zesTemperatureGetState", &nl.zesTemperatureGetState)
		bind("zesDeviceEnumPowerDomains", &nl.zesDeviceEnumPowerDomains)
		bind("zesPowerGetEnergyCounter", &nl.zesPowerGetEnergyCounter)
		bind("zesDeviceEnumMemoryModules", &nl.zesDeviceEnumMemoryModules)
		bind("zesMemoryGetState", &nl.zesMemoryGetState)
		bind("zesDeviceEnumEngineGroups", &nl.zesDeviceEnumEngineGroups)
		bind("zesEngineGetActivity", &nl.zesEngineGetActivity)
		bind("zesEngineGetProperties", &nl.zesEngineGetProperties)
		bind("zesDeviceEnumFrequencyDomains", &nl.zesDeviceEnumFrequencyDomains)
		bind("zesFrequencyGetState", &nl.zesFrequencyGetState)
		if nl.zeInit == nil || nl.zeDriverGet == nil || nl.zeDeviceGet == nil {
			errL = fmt.Errorf("level zero symbols missing")
			_ = windows.FreeLibrary(h)
			return
		}
		if os.Getenv("ZES_ENABLE_SYSMAN") == "" {
			_ = os.Setenv("ZES_ENABLE_SYSMAN", "1")
		}
		if rc := nl.zeInit(0); rc != 0 {
			errL = fmt.Errorf("zeInit: %d", rc)
			_ = windows.FreeLibrary(h)
			return
		}
		if nl.zesInit != nil {
			_ = nl.zesInit(0)
		}
		l = nl
		_ = syscall.Handle(h)
	})
	return errL
}
