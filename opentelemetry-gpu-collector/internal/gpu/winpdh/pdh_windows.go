//go:build windows

package winpdh

import (
	"fmt"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/gpu/procname"
)

const (
	cacheTTL = 200 * time.Millisecond

	pdhMoreData         = 0x800007D2
	pdhNoData           = 0x800007D5
	pdhCStatusValidData = 0
	pdhCStatusNewData   = 1
	pdhFmtDouble        = 0x00000200
	pdhFmtNoCap100      = 0x00008000
)

var (
	modPdh                           = windows.NewLazySystemDLL("pdh.dll")
	procPdhOpenQueryW                = modPdh.NewProc("PdhOpenQueryW")
	procPdhAddEnglishCounterW        = modPdh.NewProc("PdhAddEnglishCounterW")
	procPdhCollectQueryData          = modPdh.NewProc("PdhCollectQueryData")
	procPdhGetFormattedCounterArrayW = modPdh.NewProc("PdhGetFormattedCounterArrayW")
	procPdhCloseQuery                = modPdh.NewProc("PdhCloseQuery")
)

// ProcessSample is one process's GPU usage on one adapter LUID.
type ProcessSample struct {
	PID         int32
	LUIDKey     string
	MemoryBytes int64
	Util        float64 // 0..1 primary compute/3D
	EncoderUtil float64
	DecoderUtil float64
	HasMemory   bool
	HasUtil     bool
	HasEnc      bool
	HasDec      bool
}

// AdapterUsage aggregates device-level util/memory from PDH for one LUID.
type AdapterUsage struct {
	LUIDKey     string
	Util        float64 // 0..1
	EncoderUtil float64 // 0..1
	DecoderUtil float64 // 0..1
	MemoryUsed  int64
	HasUtil     bool
	HasEnc      bool
	HasDec      bool
	HasMemory   bool
}

type cache struct {
	mu        sync.Mutex
	at        time.Time
	processes []ProcessSample
	adapters  map[string]AdapterUsage
}

var shared cache

// Persistent PDH query: sample across scrapes instead of sleeping 50ms in-callback.
type pdhSession struct {
	mu         sync.Mutex
	query      uintptr
	engCounter uintptr
	memCounter uintptr
	ready      bool // true after first CollectQueryData (rates need two samples)
}

var session pdhSession

func (s *pdhSession) ensure() error {
	if s.query != 0 {
		return nil
	}
	if err := modPdh.Load(); err != nil {
		return fmt.Errorf("pdh.dll: %w", err)
	}
	var query uintptr
	if ret := pdhCall(procPdhOpenQueryW, 0, 0, uintptr(unsafe.Pointer(&query))); ret != 0 {
		return fmt.Errorf("PdhOpenQuery: 0x%X", ret)
	}
	var engCounter, memCounter uintptr
	engPath, _ := windows.UTF16PtrFromString(`\GPU Engine(*)\Utilization Percentage`)
	memPath, _ := windows.UTF16PtrFromString(`\GPU Process Memory(*)\Dedicated Usage`)
	if ret := pdhCall(procPdhAddEnglishCounterW, query, uintptr(unsafe.Pointer(engPath)), 0, uintptr(unsafe.Pointer(&engCounter))); ret != 0 {
		pdhCall(procPdhCloseQuery, query)
		return fmt.Errorf("add GPU Engine counter: 0x%X", ret)
	}
	_ = pdhCall(procPdhAddEnglishCounterW, query, uintptr(unsafe.Pointer(memPath)), 0, uintptr(unsafe.Pointer(&memCounter)))
	s.query = query
	s.engCounter = engCounter
	s.memCounter = memCounter
	s.ready = false
	return nil
}

// CollectForLUID returns ProcessUsage for processes on the given adapter LUID key.
func CollectForLUID(luidKey string) ([]gpu.ProcessUsage, error) {
	procs, _, err := scrape()
	if err != nil {
		return nil, err
	}
	out := make([]gpu.ProcessUsage, 0)
	for _, p := range procs {
		if !stringsEqualFoldLUID(p.LUIDKey, luidKey) {
			continue
		}
		pu := gpu.ProcessUsage{
			PID:            p.PID,
			ExecutableName: procname.ExecutableName(p.PID),
		}
		if p.HasMemory {
			m := p.MemoryBytes
			pu.MemoryBytes = &m
		}
		if p.HasUtil {
			u := p.Util
			if u > 1 {
				u = 1
			}
			pu.Utilization = &u
		}
		if p.HasEnc {
			e := p.EncoderUtil
			if e > 1 {
				e = 1
			}
			pu.EncoderUtil = &e
		}
		if p.HasDec {
			d := p.DecoderUtil
			if d > 1 {
				d = 1
			}
			pu.DecoderUtil = &d
		}
		out = append(out, pu)
	}
	return out, nil
}

// AdapterSnapshot returns aggregated util/memory for one LUID (DXGI+PDH fallback).
func AdapterSnapshot(luidKey string) (AdapterUsage, bool) {
	_, adapters, err := scrape()
	if err != nil {
		return AdapterUsage{}, false
	}
	for k, a := range adapters {
		if stringsEqualFoldLUID(k, luidKey) {
			return a, true
		}
	}
	return AdapterUsage{}, false
}

func scrape() ([]ProcessSample, map[string]AdapterUsage, error) {
	shared.mu.Lock()
	if shared.processes != nil && time.Since(shared.at) < cacheTTL {
		p, a := shared.processes, shared.adapters
		shared.mu.Unlock()
		return p, a, nil
	}
	shared.mu.Unlock()

	procs, adapters, err := collectPDH()
	if err != nil {
		return nil, nil, err
	}

	shared.mu.Lock()
	shared.processes = procs
	shared.adapters = adapters
	shared.at = time.Now()
	shared.mu.Unlock()
	return procs, adapters, nil
}

func collectPDH() ([]ProcessSample, map[string]AdapterUsage, error) {
	session.mu.Lock()
	defer session.mu.Unlock()

	if err := session.ensure(); err != nil {
		return nil, nil, err
	}
	q := session.query

	if ret := pdhCall(procPdhCollectQueryData, q); ret != 0 && ret != pdhNoData {
		return nil, nil, fmt.Errorf("PdhCollectQueryData: 0x%X", ret)
	}
	if !session.ready {
		// First sample primes rate counters; return empty util without sleeping.
		session.ready = true
		return nil, map[string]AdapterUsage{}, nil
	}

	byKey := make(map[string]*ProcessSample)
	adapters := make(map[string]AdapterUsage)

	if engItems, err := formattedArray(session.engCounter); err == nil {
		for _, it := range engItems {
			inst := ParseInstance(it.Name)
			if inst.PID <= 0 || inst.LUIDKey == "" {
				continue
			}
			key := fmt.Sprintf("%d|%s", inst.PID, inst.LUIDKey)
			ps := byKey[key]
			if ps == nil {
				ps = &ProcessSample{PID: inst.PID, LUIDKey: inst.LUIDKey}
				byKey[key] = ps
			}
			utilFrac := it.Value / 100.0
			if utilFrac < 0 {
				utilFrac = 0
			}
			switch NormalizeEngType(inst.EngType) {
			case "3d", "compute":
				if utilFrac > ps.Util {
					ps.Util = utilFrac
				}
				ps.HasUtil = true
			case "encode":
				if utilFrac > ps.EncoderUtil {
					ps.EncoderUtil = utilFrac
				}
				ps.HasEnc = true
			case "decode":
				if utilFrac > ps.DecoderUtil {
					ps.DecoderUtil = utilFrac
				}
				ps.HasDec = true
			}

			au := adapters[inst.LUIDKey]
			au.LUIDKey = inst.LUIDKey
			switch NormalizeEngType(inst.EngType) {
			case "3d", "compute":
				if utilFrac > au.Util {
					au.Util = utilFrac
				}
				au.HasUtil = true
			case "encode":
				if utilFrac > au.EncoderUtil {
					au.EncoderUtil = utilFrac
				}
				au.HasEnc = true
			case "decode":
				if utilFrac > au.DecoderUtil {
					au.DecoderUtil = utilFrac
				}
				au.HasDec = true
			}
			adapters[inst.LUIDKey] = au
		}
	}

	if session.memCounter != 0 {
		if memItems, err := formattedArray(session.memCounter); err == nil {
			for _, it := range memItems {
				inst := ParseInstance(it.Name)
				if inst.PID <= 0 || inst.LUIDKey == "" {
					continue
				}
				key := fmt.Sprintf("%d|%s", inst.PID, inst.LUIDKey)
				ps := byKey[key]
				if ps == nil {
					ps = &ProcessSample{PID: inst.PID, LUIDKey: inst.LUIDKey}
					byKey[key] = ps
				}
				mem := int64(it.Value)
				ps.MemoryBytes = mem
				ps.HasMemory = true

				au := adapters[inst.LUIDKey]
				au.LUIDKey = inst.LUIDKey
				au.MemoryUsed += mem
				au.HasMemory = true
				adapters[inst.LUIDKey] = au
			}
		}
	}

	out := make([]ProcessSample, 0, len(byKey))
	for _, ps := range byKey {
		out = append(out, *ps)
	}
	return out, adapters, nil
}

type fmtItem struct {
	Name  string
	Value float64
}

type pdhFmtCounterValueItemDouble struct {
	SzName   *uint16
	FmtValue struct {
		CStatus uint32
		Padding uint32
		Value   float64
	}
}

func formattedArray(counter uintptr) ([]fmtItem, error) {
	var bufSize, itemCount uint32
	ret := pdhCall(procPdhGetFormattedCounterArrayW, counter, pdhFmtDouble|pdhFmtNoCap100,
		uintptr(unsafe.Pointer(&bufSize)), uintptr(unsafe.Pointer(&itemCount)), 0)
	if ret != pdhMoreData && ret != 0 {
		if ret == pdhNoData {
			return nil, nil
		}
		return nil, fmt.Errorf("PdhGetFormattedCounterArray size: 0x%X", ret)
	}
	if bufSize == 0 {
		return nil, nil
	}
	buf := make([]byte, bufSize)
	ret = pdhCall(procPdhGetFormattedCounterArrayW, counter, pdhFmtDouble|pdhFmtNoCap100,
		uintptr(unsafe.Pointer(&bufSize)), uintptr(unsafe.Pointer(&itemCount)),
		uintptr(unsafe.Pointer(&buf[0])))
	if ret != 0 {
		if ret == pdhNoData {
			return nil, nil
		}
		return nil, fmt.Errorf("PdhGetFormattedCounterArray: 0x%X", ret)
	}

	items := make([]fmtItem, 0, itemCount)
	size := unsafe.Sizeof(pdhFmtCounterValueItemDouble{})
	for i := uint32(0); i < itemCount; i++ {
		raw := (*pdhFmtCounterValueItemDouble)(unsafe.Pointer(&buf[uintptr(i)*size]))
		if raw.FmtValue.CStatus != pdhCStatusValidData && raw.FmtValue.CStatus != pdhCStatusNewData {
			continue
		}
		name := windows.UTF16PtrToString(raw.SzName)
		items = append(items, fmtItem{Name: name, Value: raw.FmtValue.Value})
	}
	return items, nil
}

func pdhCall(p *windows.LazyProc, args ...uintptr) uintptr {
	r, _, _ := p.Call(args...)
	return r
}

func stringsEqualFoldLUID(a, b string) bool {
	if len(a) != len(b) {
		// still try case-insensitive compare
	}
	if len(a) != len(b) {
		return stringsEqualFold(a, b)
	}
	return stringsEqualFold(a, b)
}

func stringsEqualFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if ca >= 'a' && ca <= 'z' {
			ca -= 'a' - 'A'
		}
		if cb >= 'a' && cb <= 'z' {
			cb -= 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}
