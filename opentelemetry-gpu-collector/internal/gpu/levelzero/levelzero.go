// Package levelzero reads Intel GPU metrics via oneAPI Level Zero Sysman.
package levelzero

import (
	"sync"
)

// Metrics is a Sysman sample for one device.
type Metrics struct {
	Utilization        *float64 // 0-100 engine activity
	EncoderUtilization *float64 // 0-100 media encode / combined media
	DecoderUtilization *float64 // 0-100 media decode when split
	MemoryTotal        *int64
	MemoryUsed         *int64
	TemperatureC       *float64
	PowerWatts         *float64
	ClockMHz           *float64
	ThrottleReasons    *string
	Throttled          *float64
}

const (
	zesStructureTypeEngineProperties = 0x5
	zesStructureTypeFreqState        = 0x1b
	zesStructureTypeMemState         = 0x1e

	zesEngineGroupAll                 = 0
	zesEngineGroupComputeAll          = 1
	zesEngineGroupMediaAll            = 2
	zesEngineGroupComputeSingle       = 4
	zesEngineGroupRenderSingle        = 5
	zesEngineGroupMediaDecodeSingle   = 6
	zesEngineGroupMediaEncodeSingle   = 7
	zesEngineGroupMediaEnhanceSingle  = 9
	zesEngineGroup3DSingle            = 10
	zesEngineGroup3DRenderComputeAll  = 11
	zesEngineGroupRenderAll           = 12
	zesEngineGroup3DAll               = 13
	zesEngineGroupMediaCodecSingle    = 14
)

type lib struct {
	zeInit                          func(uint32) int32
	zeDriverGet                     func(*uint32, *uintptr) int32
	zeDeviceGet                     func(uintptr, *uint32, *uintptr) int32
	zesInit                         func(uint32) int32
	zesDeviceEnumTemperatureSensors func(uintptr, *uint32, *uintptr) int32
	zesTemperatureGetState          func(uintptr, *float64) int32
	zesDeviceEnumPowerDomains       func(uintptr, *uint32, *uintptr) int32
	zesPowerGetEnergyCounter        func(uintptr, *zesEnergy) int32
	zesDeviceEnumMemoryModules      func(uintptr, *uint32, *uintptr) int32
	zesMemoryGetState               func(uintptr, *zesMemState) int32
	zesDeviceEnumEngineGroups       func(uintptr, *uint32, *uintptr) int32
	zesEngineGetActivity            func(uintptr, *zesEngineStats) int32
	zesEngineGetProperties          func(uintptr, *zesEngineProps) int32
	zesDeviceEnumFrequencyDomains   func(uintptr, *uint32, *uintptr) int32
	zesFrequencyGetState            func(uintptr, *zesFreqState) int32
}

// zes_power_energy_counter_t
type zesEnergy struct {
	Energy    uint64
	Timestamp uint64
}

// zes_mem_state_t — stype/pNext/health/free/size (Go inserts ABI padding).
type zesMemState struct {
	Stype  uint32
	PNext  uintptr
	Health uint32
	Free   uint64
	Size   uint64
}

// zes_engine_stats_t
type zesEngineStats struct {
	ActiveTime uint64
	Timestamp  uint64
}

// zes_engine_properties_t
type zesEngineProps struct {
	Stype      uint32
	PNext      uintptr
	Type       uint32
	OnSubdevice uint8
	_          [3]byte
	SubdeviceId uint32
}

// zes_freq_state_t
type zesFreqState struct {
	Stype           uint32
	PNext           uintptr
	CurrentVoltage  float64
	Request         float64
	Tdp             float64
	Efficient       float64
	Actual          float64
	ThrottleReasons uint32
}

type devicePrev struct {
	engines map[uintptr]zesEngineStats
	power   map[uintptr]zesEnergy
}

var (
	once sync.Once
	l    *lib
	errL error

	prevByDev = map[uintptr]*devicePrev{}
	mu        sync.Mutex

	devicesMu     sync.Mutex
	cachedDevices []uintptr
)

// Available reports whether Sysman can be used.
func Available() bool {
	return Init() == nil && l != nil
}

func prevFor(dev uintptr) *devicePrev {
	p, ok := prevByDev[dev]
	if !ok {
		p = &devicePrev{
			engines: make(map[uintptr]zesEngineStats),
			power:   make(map[uintptr]zesEnergy),
		}
		prevByDev[dev] = p
	}
	return p
}

func listDevices() []uintptr {
	devicesMu.Lock()
	defer devicesMu.Unlock()
	if cachedDevices != nil {
		return cachedDevices
	}
	var driverCount uint32
	if rc := l.zeDriverGet(&driverCount, nil); rc != 0 || driverCount == 0 {
		return nil
	}
	drivers := make([]uintptr, driverCount)
	if rc := l.zeDriverGet(&driverCount, &drivers[0]); rc != 0 {
		return nil
	}
	var all []uintptr
	for _, drv := range drivers {
		var n uint32
		if rc := l.zeDeviceGet(drv, &n, nil); rc != 0 || n == 0 {
			continue
		}
		devs := make([]uintptr, n)
		if rc := l.zeDeviceGet(drv, &n, &devs[0]); rc != 0 {
			continue
		}
		all = append(all, devs...)
	}
	cachedDevices = all
	return cachedDevices
}

// Collect returns metrics for the deviceIndex-th Level Zero device.
func Collect(deviceIndex int) (Metrics, bool) {
	if !Available() {
		return Metrics{}, false
	}
	allDevices := listDevices()
	if deviceIndex < 0 || deviceIndex >= len(allDevices) {
		return Metrics{}, false
	}
	dev := allDevices[deviceIndex]
	m := Metrics{}

	if l.zesDeviceEnumMemoryModules != nil && l.zesMemoryGetState != nil {
		var n uint32
		if l.zesDeviceEnumMemoryModules(dev, &n, nil) == 0 && n > 0 {
			mods := make([]uintptr, n)
			if l.zesDeviceEnumMemoryModules(dev, &n, &mods[0]) == 0 {
				var total, free uint64
				for _, mod := range mods {
					var st zesMemState
					st.Stype = zesStructureTypeMemState
					if l.zesMemoryGetState(mod, &st) == 0 {
						total += st.Size
						free += st.Free
					}
				}
				if total > 0 {
					t := int64(total)
					m.MemoryTotal = &t
					used := total
					if free <= total {
						used = total - free
					}
					u := int64(used)
					m.MemoryUsed = &u
				}
			}
		}
	}

	if l.zesDeviceEnumTemperatureSensors != nil && l.zesTemperatureGetState != nil {
		var n uint32
		if l.zesDeviceEnumTemperatureSensors(dev, &n, nil) == 0 && n > 0 {
			sensors := make([]uintptr, n)
			if l.zesDeviceEnumTemperatureSensors(dev, &n, &sensors[0]) == 0 {
				var temp float64
				if l.zesTemperatureGetState(sensors[0], &temp) == 0 {
					m.TemperatureC = &temp
				}
			}
		}
	}

	if l.zesDeviceEnumFrequencyDomains != nil && l.zesFrequencyGetState != nil {
		var n uint32
		if l.zesDeviceEnumFrequencyDomains(dev, &n, nil) == 0 && n > 0 {
			doms := make([]uintptr, n)
			if l.zesDeviceEnumFrequencyDomains(dev, &n, &doms[0]) == 0 {
				var st zesFreqState
				st.Stype = zesStructureTypeFreqState
				if l.zesFrequencyGetState(doms[0], &st) == 0 {
					if st.Actual >= 0 {
						m.ClockMHz = &st.Actual
					}
					if st.ThrottleReasons != 0 {
						t := 1.0
						m.Throttled = &t
						r := "hw_throttle"
						m.ThrottleReasons = &r
					} else {
						t := 0.0
						m.Throttled = &t
					}
				}
			}
		}
	}

	if l.zesDeviceEnumEngineGroups != nil && l.zesEngineGetActivity != nil {
		var n uint32
		if l.zesDeviceEnumEngineGroups(dev, &n, nil) == 0 && n > 0 {
			engs := make([]uintptr, n)
			if l.zesDeviceEnumEngineGroups(dev, &n, &engs[0]) == 0 {
				type bucket struct{ active, time uint64 }
				var genAll, genSingle, enc, dec, media bucket
				var hasGenAll, hasEnc, hasDec bool
				seen := make(map[uintptr]struct{}, len(engs))
				mu.Lock()
				p := prevFor(dev)
				for _, eng := range engs {
					var st zesEngineStats
					if l.zesEngineGetActivity(eng, &st) != 0 {
						continue
					}
					seen[eng] = struct{}{}
					var dActive, dTime uint64
					if prev, ok := p.engines[eng]; ok &&
						st.Timestamp > prev.Timestamp &&
						st.ActiveTime >= prev.ActiveTime {
						dActive = st.ActiveTime - prev.ActiveTime
						dTime = st.Timestamp - prev.Timestamp
					}
					p.engines[eng] = st
					if dTime == 0 {
						continue
					}
					engType := uint32(zesEngineGroupAll)
					if l.zesEngineGetProperties != nil {
						var props zesEngineProps
						props.Stype = zesStructureTypeEngineProperties
						if l.zesEngineGetProperties(eng, &props) == 0 {
							engType = props.Type
						}
					}
					switch engType {
					case zesEngineGroupAll, zesEngineGroupComputeAll,
						zesEngineGroup3DRenderComputeAll, zesEngineGroupRenderAll, zesEngineGroup3DAll:
						hasGenAll = true
						genAll.active += dActive
						genAll.time += dTime
					case zesEngineGroupComputeSingle, zesEngineGroupRenderSingle, zesEngineGroup3DSingle:
						genSingle.active += dActive
						genSingle.time += dTime
					case zesEngineGroupMediaEncodeSingle:
						hasEnc = true
						enc.active += dActive
						enc.time += dTime
					case zesEngineGroupMediaDecodeSingle:
						hasDec = true
						dec.active += dActive
						dec.time += dTime
					case zesEngineGroupMediaAll, zesEngineGroupMediaEnhanceSingle, zesEngineGroupMediaCodecSingle:
						media.active += dActive
						media.time += dTime
					}
				}
				for k := range p.engines {
					if _, ok := seen[k]; !ok {
						delete(p.engines, k)
					}
				}
				mu.Unlock()

				utilBucket := genSingle
				if hasGenAll {
					utilBucket = genAll
				}
				if utilBucket.time > 0 {
					u := 100.0 * float64(utilBucket.active) / float64(utilBucket.time)
					m.Utilization = &u
				}
				if hasEnc && enc.time > 0 {
					e := 100.0 * float64(enc.active) / float64(enc.time)
					m.EncoderUtilization = &e
				} else if !hasEnc && media.time > 0 {
					// Combined media → encoder only (do not invent decoder).
					e := 100.0 * float64(media.active) / float64(media.time)
					m.EncoderUtilization = &e
				}
				if hasDec && dec.time > 0 {
					d := 100.0 * float64(dec.active) / float64(dec.time)
					m.DecoderUtilization = &d
				}
			}
		}
	}

	if l.zesDeviceEnumPowerDomains != nil && l.zesPowerGetEnergyCounter != nil {
		var n uint32
		if l.zesDeviceEnumPowerDomains(dev, &n, nil) == 0 && n > 0 {
			doms := make([]uintptr, n)
			if l.zesDeviceEnumPowerDomains(dev, &n, &doms[0]) == 0 {
				var en zesEnergy
				if l.zesPowerGetEnergyCounter(doms[0], &en) == 0 {
					mu.Lock()
					p := prevFor(dev)
					prev, ok := p.power[doms[0]]
					p.power[doms[0]] = en
					for k := range p.power {
						if k != doms[0] {
							delete(p.power, k)
						}
					}
					mu.Unlock()
					if ok && en.Timestamp > prev.Timestamp && en.Energy >= prev.Energy {
						dt := float64(en.Timestamp-prev.Timestamp) / 1e6
						if dt > 0 {
							pw := (float64(en.Energy-prev.Energy) / 1e6) / dt
							m.PowerWatts = &pw
						}
					}
				}
			}
		}
	}

	ok := m.Utilization != nil || m.EncoderUtilization != nil || m.DecoderUtilization != nil ||
		m.MemoryTotal != nil || m.TemperatureC != nil || m.PowerWatts != nil || m.ClockMHz != nil || m.Throttled != nil
	return m, ok
}
