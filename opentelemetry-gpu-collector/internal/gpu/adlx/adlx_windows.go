//go:build windows

package adlx

import (
	"fmt"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Metrics is a point-in-time AMD GPU sample.
type Metrics struct {
	Utilization  *float64 // 0-100
	TemperatureC *float64
	ClockMHz     *float64
	VRAMClockMHz *float64
	FanRPM       *float64
	PowerWatts   *float64
}

var (
	initOnce sync.Once
	initErr  error
	adlDLL   *windows.LazyDLL

	adlCreate                    *windows.LazyProc
	adlDestroy                   *windows.LazyProc
	adlAdapterNumberOfAdapters   *windows.LazyProc
	adlOverdrive5CurrentActivity *windows.LazyProc
	adlOverdrive5Temperature     *windows.LazyProc
	adlOverdrive5FanSpeed        *windows.LazyProc
	context                      uintptr
	mallocCB                     uintptr

	kernel32  = windows.NewLazySystemDLL("kernel32.dll")
	heapAlloc = kernel32.NewProc("HeapAlloc")
	getHeap   = kernel32.NewProc("GetProcessHeap")
)

type adlActivity struct {
	Size            int32
	EngineClock     int32
	MemoryClock     int32
	Vddc            int32
	ActivityPercent int32
	CurrentBusSpeed int32
	CurrentBusLanes int32
	MaximumBusLanes int32
	Reserved        int32
}

type adlTemperature struct {
	Size        int32
	Temperature int32
}

type adlFanSpeedValue struct {
	Size      int32
	SpeedType int32
	FanSpeed  int32
	Flags     int32
}

func adlMalloc(size int32) uintptr {
	if size <= 0 {
		return 0
	}
	heap, _, _ := getHeap.Call()
	p, _, _ := heapAlloc.Call(heap, 0, uintptr(size))
	return p
}

// Init loads ADL2 from the AMD driver.
func Init() error {
	initOnce.Do(func() {
		adlDLL = windows.NewLazyDLL("atiadlxx.dll")
		if err := adlDLL.Load(); err != nil {
			adlDLL = windows.NewLazyDLL("atiadlxy.dll")
			if err2 := adlDLL.Load(); err2 != nil {
				initErr = fmt.Errorf("load ADL: %v / %v", err, err2)
				return
			}
		}
		adlCreate = adlDLL.NewProc("ADL2_Main_Control_Create")
		adlDestroy = adlDLL.NewProc("ADL2_Main_Control_Destroy")
		adlAdapterNumberOfAdapters = adlDLL.NewProc("ADL2_Adapter_NumberOfAdapters_Get")
		adlOverdrive5CurrentActivity = adlDLL.NewProc("ADL2_Overdrive5_CurrentActivity_Get")
		adlOverdrive5Temperature = adlDLL.NewProc("ADL2_Overdrive5_Temperature_Get")
		adlOverdrive5FanSpeed = adlDLL.NewProc("ADL2_Overdrive5_FanSpeed_Get")

		mallocCB = windows.NewCallback(adlMalloc)
		const adlOK = 0
		r, _, _ := adlCreate.Call(mallocCB, 1, uintptr(unsafe.Pointer(&context)))
		if r != adlOK {
			initErr = fmt.Errorf("ADL2_Main_Control_Create: %d", r)
			context = 0
			return
		}
	})
	return initErr
}

// Available reports whether ADL initialized.
func Available() bool {
	return Init() == nil && context != 0
}

// Collect returns metrics for adapter index (0-based among ADL adapters).
func Collect(index int) (Metrics, bool) {
	if !Available() {
		return Metrics{}, false
	}
	var num int32
	if r, _, _ := adlAdapterNumberOfAdapters.Call(context, uintptr(unsafe.Pointer(&num))); r != 0 || num <= 0 {
		return Metrics{}, false
	}
	if index < 0 || index >= int(num) {
		return Metrics{}, false
	}
	idx := int32(index)
	m := Metrics{}
	var act adlActivity
	act.Size = int32(unsafe.Sizeof(act))
	if r, _, _ := adlOverdrive5CurrentActivity.Call(context, uintptr(idx), uintptr(unsafe.Pointer(&act))); r == 0 {
		u := float64(act.ActivityPercent)
		m.Utilization = &u
		clk := float64(act.EngineClock) / 100.0
		m.ClockMHz = &clk
		mclk := float64(act.MemoryClock) / 100.0
		m.VRAMClockMHz = &mclk
	}
	var temp adlTemperature
	temp.Size = int32(unsafe.Sizeof(temp))
	if r, _, _ := adlOverdrive5Temperature.Call(context, uintptr(idx), 0, uintptr(unsafe.Pointer(&temp))); r == 0 {
		t := float64(temp.Temperature) / 1000.0
		m.TemperatureC = &t
	}
	var fan adlFanSpeedValue
	fan.Size = int32(unsafe.Sizeof(fan))
	fan.SpeedType = 1
	if r, _, _ := adlOverdrive5FanSpeed.Call(context, uintptr(idx), 0, uintptr(unsafe.Pointer(&fan))); r == 0 {
		f := float64(fan.FanSpeed)
		m.FanRPM = &f
	}
	return m, m.Utilization != nil || m.TemperatureC != nil || m.ClockMHz != nil || m.FanRPM != nil
}

// Close releases ADL.
func Close() {
	if context != 0 && adlDestroy != nil {
		_, _, _ = adlDestroy.Call(context)
		context = 0
	}
}
