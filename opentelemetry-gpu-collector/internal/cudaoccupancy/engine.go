// Package cudaoccupancy implements Datadog-parity CUDA stream-sync occupancy.
//
// This is a CPU-side model: spans run from kernel launch to sync API return,
// not true hardware SM occupancy. See package docs and metrics descriptions.
package cudaoccupancy

import (
	"sort"
	"sync"
	"time"
)

const (
	DefaultMaxActiveStreams      = 100
	DefaultMaxKernelLaunches     = 1000
	DefaultMaxPendingKernelSpans = 1000
	DefaultStreamInactiveTimeout = 30 * time.Second
)

// KernelLaunch is one cudaLaunchKernel (or cuLaunchKernel) observation.
type KernelLaunch struct {
	PID                    uint32
	TID                    uint32
	StreamID               uint64
	DeviceUUID             string
	KtimeNs                uint64
	GridX, GridY, GridZ    uint32
	BlockX, BlockY, BlockZ uint32
}

// SyncEvent closes spans on a stream (or all streams on a device when DeviceWide).
type SyncEvent struct {
	PID        uint32
	TID        uint32
	StreamID   uint64
	DeviceUUID string
	KtimeNs    uint64
	DeviceWide bool
}

// SetDeviceEvent records cudaSetDevice success for (pid, tid).
type SetDeviceEvent struct {
	PID        uint32
	TID        uint32
	DeviceIdx  int
	DeviceUUID string
	KtimeNs    uint64
}

// ProcessStats is one interval's occupancy for a process on a device.
type ProcessStats struct {
	PID          uint32
	DeviceUUID   string
	UsedCores    float64 // normalized
	ActiveTime   float64 // 0..1 fraction of interval
	RawUsedCores float64
}

// DeviceStats is device-wide active time for an interval.
type DeviceStats struct {
	DeviceUUID string
	ActiveTime float64 // 0..1
	CoreLimit  float64
}

// FlushResult is emitted by Engine.GetAndFlush.
type FlushResult struct {
	Processes []ProcessStats
	Devices   []DeviceStats
}

type kernelSpan struct {
	startKtime     uint64
	endKtime       uint64
	avgThreadCount uint64
	numKernels     uint64
}

type streamKey struct {
	pid      uint32
	streamID uint64
	gpuUUID  string // for default stream (streamID==0)
}

type streamHandler struct {
	key              streamKey
	gpuUUID          string
	pid              uint32
	launches         []KernelLaunch
	pending          []*kernelSpan
	lastEventKtimeNs uint64
	ended            bool
}

type aggregatorKey struct {
	pid     uint32
	gpuUUID string
}

type aggregator struct {
	deviceMaxThreads       uint64
	lastCheckKtime         uint64
	measuredIntervalNs     int64
	totalThreadSecondsUsed float64
	activeIntervals        [][2]uint64
	isActive               bool
}

// Engine is the Datadog-style stream occupancy engine.
type Engine struct {
	mu sync.Mutex

	streams       map[streamKey]*streamHandler
	globalStreams map[streamKey]*streamHandler // stream_id==0 keyed by pid+uuid
	aggregators   map[aggregatorKey]*aggregator

	// tid -> last cudaSetDevice UUID
	threadDevice map[uint64]string // pid<<32|tid
	deviceCores  map[string]uint64 // uuid -> core count
	deviceIndex  map[int]string    // cuda device index -> uuid

	lastFlushKtime uint64
	nowFn          func() uint64

	maxActiveStreams  int
	maxKernelLaunches int
	maxPendingSpans   int
	inactiveTimeoutNs uint64

	RejectedStreams uint64
	RejectedSpans   uint64
	ForcedSyncs     uint64
}

// NewEngine creates an occupancy engine. deviceCores maps GPU UUID -> CUDA core count.
func NewEngine(deviceCores map[string]uint64) *Engine {
	cores := deviceCores
	if cores == nil {
		cores = map[string]uint64{}
	}
	return &Engine{
		streams:           make(map[streamKey]*streamHandler),
		globalStreams:     make(map[streamKey]*streamHandler),
		aggregators:       make(map[aggregatorKey]*aggregator),
		threadDevice:      make(map[uint64]string),
		deviceCores:       cores,
		deviceIndex:       make(map[int]string),
		nowFn:             monotonicNowNs,
		maxActiveStreams:  DefaultMaxActiveStreams,
		maxKernelLaunches: DefaultMaxKernelLaunches,
		maxPendingSpans:   DefaultMaxPendingKernelSpans,
		inactiveTimeoutNs: uint64(DefaultStreamInactiveTimeout.Nanoseconds()),
	}
}

// SetDeviceIndexUUID maps a CUDA device index to a GPU UUID (from NVML discovery).
func (e *Engine) SetDeviceIndexUUID(idx int, uuid string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.deviceIndex[idx] = uuid
	if _, ok := e.deviceCores[uuid]; !ok {
		e.deviceCores[uuid] = 0
	}
}

func threadKey(pid, tid uint32) uint64 {
	return uint64(pid)<<32 | uint64(tid)
}

// HandleSetDevice records the active device for a thread.
func (e *Engine) HandleSetDevice(ev SetDeviceEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	uuid := ev.DeviceUUID
	if uuid == "" {
		uuid = e.deviceIndex[ev.DeviceIdx]
	}
	if uuid == "" {
		return
	}
	e.threadDevice[threadKey(ev.PID, ev.TID)] = uuid
}

// HandleLaunch buffers a kernel launch on its stream.
func (e *Engine) HandleLaunch(ev KernelLaunch) {
	e.mu.Lock()
	defer e.mu.Unlock()

	uuid := ev.DeviceUUID
	if uuid == "" {
		uuid = e.threadDevice[threadKey(ev.PID, ev.TID)]
	}
	if uuid == "" {
		// Fallback: first known device
		for _, u := range e.deviceIndex {
			uuid = u
			break
		}
	}
	if uuid == "" {
		uuid = "unknown"
	}
	ev.DeviceUUID = uuid

	h := e.getOrCreateStream(ev.PID, ev.StreamID, uuid, ev.KtimeNs)
	if h == nil {
		return
	}
	h.lastEventKtimeNs = ev.KtimeNs
	h.launches = append(h.launches, ev)
	if len(h.launches) >= e.maxKernelLaunches {
		e.ForcedSyncs++
		e.markSynchronization(h, ev.KtimeNs+1)
	}
}

// HandleSync closes spans for a stream or all streams on a device.
func (e *Engine) HandleSync(ev SyncEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()

	uuid := ev.DeviceUUID
	if uuid == "" {
		uuid = e.threadDevice[threadKey(ev.PID, ev.TID)]
	}

	if ev.DeviceWide || ev.StreamID == 0 {
		e.fanOutDeviceSync(ev.PID, uuid, ev.KtimeNs)
		return
	}
	key := streamKey{pid: ev.PID, streamID: ev.StreamID}
	h := e.streams[key]
	if h == nil {
		return
	}
	h.lastEventKtimeNs = ev.KtimeNs
	e.markSynchronization(h, ev.KtimeNs)
}

func (e *Engine) fanOutDeviceSync(pid uint32, uuid string, ts uint64) {
	if uuid == "" {
		uuid = e.threadDevice[threadKey(pid, 0)]
	}
	// No cudaSetDevice yet: close all streams for this PID so launches still complete.
	if uuid == "" {
		for _, h := range e.globalStreams {
			if h.pid == pid {
				h.lastEventKtimeNs = ts
				e.markSynchronization(h, ts)
			}
		}
		for _, h := range e.streams {
			if h.pid == pid {
				h.lastEventKtimeNs = ts
				e.markSynchronization(h, ts)
			}
		}
		return
	}
	gkey := streamKey{pid: pid, streamID: 0, gpuUUID: uuid}
	if h := e.globalStreams[gkey]; h != nil {
		h.lastEventKtimeNs = ts
		e.markSynchronization(h, ts)
	}
	for _, h := range e.streams {
		if h.pid == pid && h.gpuUUID == uuid {
			h.lastEventKtimeNs = ts
			e.markSynchronization(h, ts)
		}
	}
}

const maxGlobalActiveStreams = 1000 // hard cap across all PIDs

func (e *Engine) getOrCreateStream(pid uint32, streamID uint64, uuid string, ts uint64) *streamHandler {
	if streamID == 0 {
		key := streamKey{pid: pid, streamID: 0, gpuUUID: uuid}
		if h := e.globalStreams[key]; h != nil {
			return h
		}
		if e.activeStreamCountForPID(pid) >= e.maxActiveStreams || e.activeStreamCount() >= maxGlobalActiveStreams {
			e.RejectedStreams++
			return nil
		}
		h := &streamHandler{key: key, gpuUUID: uuid, pid: pid, lastEventKtimeNs: ts}
		e.globalStreams[key] = h
		return h
	}
	key := streamKey{pid: pid, streamID: streamID}
	if h := e.streams[key]; h != nil {
		return h
	}
	if e.activeStreamCountForPID(pid) >= e.maxActiveStreams || e.activeStreamCount() >= maxGlobalActiveStreams {
		e.RejectedStreams++
		return nil
	}
	h := &streamHandler{key: key, gpuUUID: uuid, pid: pid, lastEventKtimeNs: ts}
	e.streams[key] = h
	return h
}

func (e *Engine) activeStreamCount() int {
	return len(e.streams) + len(e.globalStreams)
}

func (e *Engine) activeStreamCountForPID(pid uint32) int {
	n := 0
	for _, h := range e.streams {
		if h.pid == pid {
			n++
		}
	}
	for _, h := range e.globalStreams {
		if h.pid == pid {
			n++
		}
	}
	return n
}

func (e *Engine) markSynchronization(h *streamHandler, ts uint64) {
	span := buildKernelSpan(h.launches, ts)
	if span != nil {
		if len(h.pending) >= e.maxPendingSpans {
			e.RejectedSpans++
		} else {
			h.pending = append(h.pending, span)
		}
	}
	// Keep launches at/after ts (Datadog uses >=)
	kept := h.launches[:0]
	for _, l := range h.launches {
		if l.KtimeNs >= ts {
			kept = append(kept, l)
		}
	}
	h.launches = kept
}

func buildKernelSpan(launches []KernelLaunch, maxTime uint64) *kernelSpan {
	if len(launches) == 0 {
		return nil
	}
	span := &kernelSpan{
		startKtime: ^uint64(0),
		endKtime:   maxTime,
	}
	var sumThreads uint64
	for _, l := range launches {
		if l.KtimeNs >= maxTime {
			continue
		}
		if l.KtimeNs < span.startKtime {
			span.startKtime = l.KtimeNs
		}
		grid := uint64(l.GridX) * uint64(l.GridY) * uint64(l.GridZ)
		block := uint64(l.BlockX) * uint64(l.BlockY) * uint64(l.BlockZ)
		sumThreads += grid * block
		span.numKernels++
	}
	if span.numKernels == 0 {
		return nil
	}
	span.avgThreadCount = sumThreads / span.numKernels
	return span
}

// GetAndFlush aggregates spans since the last flush and returns normalized stats.
func (e *Engine) GetAndFlush() FlushResult {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := e.nowFn()
	if e.lastFlushKtime == 0 {
		e.lastFlushKtime = now
		// Still collect open spans with end=now for first interval baseline
	}
	intervalNs := int64(now - e.lastFlushKtime)
	if intervalNs <= 0 {
		intervalNs = 1
	}

	// Reset aggregator activity
	for _, agg := range e.aggregators {
		agg.isActive = false
		agg.totalThreadSecondsUsed = 0
		agg.activeIntervals = agg.activeIntervals[:0]
		agg.lastCheckKtime = e.lastFlushKtime
		agg.measuredIntervalNs = intervalNs
	}

	deviceIntervals := make(map[string][][2]uint64)

	consume := func(h *streamHandler) {
		// Snapshot open span
		if open := buildKernelSpan(h.launches, now); open != nil {
			e.feedSpan(h, open, deviceIntervals, intervalNs)
		}
		for _, span := range h.pending {
			e.feedSpan(h, span, deviceIntervals, intervalNs)
		}
		h.pending = h.pending[:0]
	}

	for _, h := range e.streams {
		consume(h)
	}
	for _, h := range e.globalStreams {
		consume(h)
	}

	// Normalize process cores
	rawByDevice := make(map[string]float64)
	for key, agg := range e.aggregators {
		if !agg.isActive {
			continue
		}
		raw := agg.getAverageCoreUsage()
		rawByDevice[key.gpuUUID] += raw
	}

	factors := make(map[string]float64)
	for uuid, total := range rawByDevice {
		cores := float64(e.deviceCores[uuid])
		if cores <= 0 {
			cores = total // no clamp info
		}
		if total > cores && cores > 0 {
			factors[uuid] = total / cores
		} else {
			factors[uuid] = 1
		}
	}

	var result FlushResult
	for key, agg := range e.aggregators {
		if !agg.isActive {
			continue
		}
		raw := agg.getAverageCoreUsage()
		factor := factors[key.gpuUUID]
		if factor < 1 {
			factor = 1
		}
		active := agg.getActiveTimeFrac()
		result.Processes = append(result.Processes, ProcessStats{
			PID:          key.pid,
			DeviceUUID:   key.gpuUUID,
			UsedCores:    raw / factor,
			ActiveTime:   active,
			RawUsedCores: raw,
		})
	}

	for uuid, intervals := range deviceIntervals {
		activeNs := MergeIntervals(intervals)
		frac := float64(activeNs) / float64(intervalNs)
		if frac > 1 {
			frac = 1
		}
		result.Devices = append(result.Devices, DeviceStats{
			DeviceUUID: uuid,
			ActiveTime: frac,
			CoreLimit:  float64(e.deviceCores[uuid]),
		})
	}

	e.lastFlushKtime = now
	e.cleanupInactive(now)
	return result
}

func (e *Engine) feedSpan(h *streamHandler, span *kernelSpan, deviceIntervals map[string][][2]uint64, intervalNs int64) {
	key := aggregatorKey{pid: h.pid, gpuUUID: h.gpuUUID}
	agg := e.aggregators[key]
	if agg == nil {
		agg = &aggregator{deviceMaxThreads: e.deviceCores[h.gpuUUID]}
		e.aggregators[key] = agg
	}
	if agg.deviceMaxThreads == 0 {
		agg.deviceMaxThreads = e.deviceCores[h.gpuUUID]
	}
	agg.lastCheckKtime = e.lastFlushKtime
	agg.measuredIntervalNs = intervalNs
	agg.isActive = true
	agg.processKernelSpan(span)

	start := span.startKtime
	end := span.endKtime
	if start < e.lastFlushKtime {
		start = e.lastFlushKtime
	}
	intervalEnd := e.lastFlushKtime + uint64(intervalNs)
	if end > intervalEnd {
		end = intervalEnd
	}
	if start < end {
		deviceIntervals[h.gpuUUID] = append(deviceIntervals[h.gpuUUID], [2]uint64{start, end})
	}
}

func (agg *aggregator) processKernelSpan(span *kernelSpan) {
	tsStart := span.startKtime
	tsEnd := span.endKtime
	if agg.lastCheckKtime > tsStart {
		tsStart = agg.lastCheckKtime
	}
	intervalEnd := agg.lastCheckKtime + uint64(agg.measuredIntervalNs)
	if tsEnd > intervalEnd {
		tsEnd = intervalEnd
	}
	if tsEnd <= tsStart {
		return
	}
	durationSec := float64(tsEnd-tsStart) / 1e9
	activeThreads := span.avgThreadCount
	if agg.deviceMaxThreads > 0 && activeThreads > agg.deviceMaxThreads {
		activeThreads = agg.deviceMaxThreads
	}
	agg.totalThreadSecondsUsed += durationSec * float64(activeThreads)
	agg.activeIntervals = append(agg.activeIntervals, [2]uint64{tsStart, tsEnd})
}

func (agg *aggregator) getAverageCoreUsage() float64 {
	if agg.measuredIntervalNs == 0 {
		return 0
	}
	intervalSecs := float64(agg.measuredIntervalNs) / 1e9
	return agg.totalThreadSecondsUsed / intervalSecs
}

func (agg *aggregator) getActiveTimeFrac() float64 {
	if agg.measuredIntervalNs <= 0 {
		return 0
	}
	activeNs := MergeIntervals(agg.activeIntervals)
	frac := float64(activeNs) / float64(agg.measuredIntervalNs)
	if frac > 1 {
		frac = 1
	}
	return frac
}

func (e *Engine) cleanupInactive(now uint64) {
	livePIDs := make(map[uint32]struct{})
	for key, h := range e.streams {
		if h.lastEventKtimeNs > 0 && now > h.lastEventKtimeNs && now-h.lastEventKtimeNs > e.inactiveTimeoutNs {
			delete(e.streams, key)
			continue
		}
		livePIDs[h.pid] = struct{}{}
	}
	for key, h := range e.globalStreams {
		if h.lastEventKtimeNs > 0 && now > h.lastEventKtimeNs && now-h.lastEventKtimeNs > e.inactiveTimeoutNs {
			delete(e.globalStreams, key)
			continue
		}
		livePIDs[h.pid] = struct{}{}
	}
	// Drop aggregators and thread→device entries for PIDs with no live streams.
	for key := range e.aggregators {
		if _, ok := livePIDs[key.pid]; !ok {
			delete(e.aggregators, key)
		}
	}
	for tk := range e.threadDevice {
		pid := uint32(tk >> 32)
		if _, ok := livePIDs[pid]; !ok {
			delete(e.threadDevice, tk)
		}
	}
}

// MergeIntervals unions overlapping [start,end) intervals and returns total covered ns.
func MergeIntervals(intervals [][2]uint64) uint64 {
	if len(intervals) == 0 {
		return 0
	}
	sort.Slice(intervals, func(i, j int) bool {
		return intervals[i][0] < intervals[j][0]
	})
	var total uint64
	curStart, curEnd := intervals[0][0], intervals[0][1]
	for i := 1; i < len(intervals); i++ {
		if intervals[i][0] <= curEnd {
			if intervals[i][1] > curEnd {
				curEnd = intervals[i][1]
			}
		} else {
			total += curEnd - curStart
			curStart, curEnd = intervals[i][0], intervals[i][1]
		}
	}
	total += curEnd - curStart
	return total
}
