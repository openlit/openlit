//go:build linux || darwin || freebsd || netbsd

package levelzero

import (
	"fmt"
	"os"

	"github.com/ebitengine/purego"
)

// Init loads Level Zero on Unix.
func Init() error {
	once.Do(func() {
		h, err := purego.Dlopen("libze_loader.so.1", purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if err != nil {
			h, err = purego.Dlopen("libze_loader.so", purego.RTLD_NOW|purego.RTLD_GLOBAL)
		}
		if err != nil {
			errL = fmt.Errorf("dlopen libze_loader: %w", err)
			return
		}
		nl := &lib{}
		bind := func(name string, fptr any) {
			sym, err := purego.Dlsym(h, name)
			if err != nil {
				return
			}
			purego.RegisterFunc(fptr, sym)
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
			return
		}
		// ze device handles are valid for zes* when Sysman is enabled via env
		// (legacy) and/or explicit zesInit.
		if os.Getenv("ZES_ENABLE_SYSMAN") == "" {
			_ = os.Setenv("ZES_ENABLE_SYSMAN", "1")
		}
		if rc := nl.zeInit(0); rc != 0 {
			errL = fmt.Errorf("zeInit: %d", rc)
			return
		}
		if nl.zesInit != nil {
			if rc := nl.zesInit(0); rc != 0 {
				// Non-fatal: some loaders only need ZES_ENABLE_SYSMAN + zeInit.
				_ = rc
			}
		}
		l = nl
	})
	return errL
}
