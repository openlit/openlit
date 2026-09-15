//go:build linux && (amd64 || arm64)

package dcgm

import (
	"encoding/binary"
	"fmt"
	"log/slog"
	"math"
	"os"
	"sync"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"
)

const (
	dcgmSTOK               = 0
	dcgmOperationModeAuto  = 1
	dcgmGroupEmpty         = 1
	dcgmFEGpu              = 1
	dcgmMaxNumDevices      = 32
	dcgmMaxStrLength       = 256
	dcgmMaxBlobLength      = 4096
	dcgmFieldValueSize     = 4120 // sizeof(dcgmFieldValue_v1) on linux amd64/arm64
	dcgmFieldValueVersion1 = uint32(dcgmFieldValueSize) | (1 << 24)

	dcgmFP64Blank  = 140737488355328.0
	dcgmInt64Blank = int64(0x7ffffffffffffff0)

	dcgmFTDouble = uint16('d')
	dcgmFTInt64  = uint16('i')
	dcgmFTString = uint16('s')

	maxKeepAgeSec   = 2.0
	maxKeepSamples  = 2
	defaultLibPath  = "/lib64/libdcgm.so"
	altLibPath      = "/usr/lib/x86_64-linux-gnu/libdcgm.so"
	altLibPathArm64 = "/usr/lib/aarch64-linux-gnu/libdcgm.so"
)

type dcgmAPI struct {
	handle uintptr

	initFn               func() int32
	shutdown             func() int32
	startEmbedded        func(opMode int32, pHandle *uintptr) int32
	stopEmbedded         func(handle uintptr) int32
	connect              func(ipAddress *byte, pHandle *uintptr) int32
	disconnect           func(handle uintptr) int32
	groupCreate          func(handle uintptr, typ int32, groupName *byte, pGroup *uintptr) int32
	groupDestroy         func(handle uintptr, group uintptr) int32
	groupAddEntity       func(handle uintptr, group uintptr, entityGroup int32, entityID uint32) int32
	fieldGroupCreate     func(handle uintptr, numFieldIDs int32, fieldIDs *uint16, name *byte, pFG *uintptr) int32
	fieldGroupDestroy    func(handle uintptr, fg uintptr) int32
	watchFields          func(handle uintptr, group uintptr, fg uintptr, updateFreq int64, maxKeepAge float64, maxKeepSamples int32) int32
	unwatchFields        func(handle uintptr, group uintptr, fg uintptr) int32
	getAllSupportedDevs  func(handle uintptr, gpuIDList *[dcgmMaxNumDevices]uint32, count *int32) int32
	getLatestForFields   func(handle uintptr, gpuID int32, fields *uint16, count uint32, values unsafe.Pointer) int32
	profPause            func(handle uintptr) int32
	profResume           func(handle uintptr) int32
	profWatchFields      func(handle uintptr, watchFields unsafe.Pointer) int32 // optional (DCGM 2.x)
	profUnwatchFields    func(handle uintptr, unwatch unsafe.Pointer) int32     // optional
}

type liveClient struct {
	api          *dcgmAPI
	handle       uintptr
	groupID      uintptr
	fieldGroupID uintptr
	gpuIDs       []uint
	fields       []uint16
	fieldPtrs    []uint16 // contiguous for C calls
	interval     time.Duration
	logger       *slog.Logger
	standalone   bool
	profEnabled  bool // false when prof watch failed at init
	profPaused   bool // true while PauseProfiling is active (API + timer)
	pause        *pauseController

	mu     sync.Mutex
	closed bool
}

func newPlatformClient(libPath, address string, fields []uint16, interval time.Duration, logger *slog.Logger) (Client, error) {
	if len(fields) == 0 {
		fields = ParseFieldsCSV("50,100,155,203,204,1001,1002,1003,1004,1005,1006,1007,1008,1009,1010,1011,1012")
	}
	fields = EnsureIdentityFields(fields)

	api, err := loadDCGM(libPath, logger)
	if err != nil {
		logger.Warn("DCGM library unavailable", "error", err)
		return UnavailableClient{}, nil
	}

	c := &liveClient{
		api:         api,
		fields:      fields,
		fieldPtrs:   append([]uint16(nil), fields...),
		interval:    interval,
		logger:      logger,
		pause:       newPauseController(),
		profEnabled: true,
	}

	if rc := api.initFn(); rc != dcgmSTOK {
		logger.Warn("dcgmInit failed", "rc", rc)
		_ = api.shutdown()
		purego.Dlclose(api.handle)
		return UnavailableClient{}, nil
	}

	if address != "" {
		c.standalone = true
		ip := cString(address)
		rc := api.connect(&ip[0], &c.handle)
		if rc != dcgmSTOK {
			logger.Warn("dcgmConnect failed", "address", address, "rc", rc)
			_ = api.shutdown()
			purego.Dlclose(api.handle)
			return UnavailableClient{}, nil
		}
	} else {
		rc := api.startEmbedded(dcgmOperationModeAuto, &c.handle)
		if rc != dcgmSTOK {
			logger.Warn("dcgmStartEmbedded failed", "rc", rc)
			_ = api.shutdown()
			purego.Dlclose(api.handle)
			return UnavailableClient{}, nil
		}
	}

	if err := c.setupGroups(); err != nil {
		logger.Warn("DCGM group setup failed", "error", err)
		_ = c.Close()
		return UnavailableClient{}, nil
	}

	logger.Info("DCGM backend ready",
		"gpus", len(c.gpuIDs),
		"fields", len(c.fields),
		"interval", interval.String(),
		"standalone", c.standalone,
		"prof_enabled", c.profEnabled,
	)
	return c, nil
}

func loadDCGM(libPath string, logger *slog.Logger) (*dcgmAPI, error) {
	candidates := []string{}
	if libPath != "" {
		candidates = append(candidates, libPath)
		if libPath == defaultLibPath {
			candidates = append(candidates, libPath+".4", libPath+".3", libPath+".2")
		}
	}
	candidates = append(candidates,
		defaultLibPath, defaultLibPath+".4", defaultLibPath+".3",
		altLibPath, altLibPathArm64,
		"libdcgm.so.4", "libdcgm.so.3", "libdcgm.so.2", "libdcgm.so",
	)

	var lastErr error
	seen := map[string]struct{}{}
	for _, path := range candidates {
		if path == "" {
			continue
		}
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		h, err := purego.Dlopen(path, purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if err != nil {
			lastErr = err
			continue
		}
		api := &dcgmAPI{handle: h}
		bind := func(name string, fptr any) error {
			sym, err := purego.Dlsym(h, name)
			if err != nil {
				return err
			}
			purego.RegisterFunc(fptr, sym)
			return nil
		}
		required := []struct {
			name string
			fptr any
		}{
			{"dcgmInit", &api.initFn},
			{"dcgmShutdown", &api.shutdown},
			{"dcgmStartEmbedded", &api.startEmbedded},
			{"dcgmStopEmbedded", &api.stopEmbedded},
			{"dcgmConnect", &api.connect},
			{"dcgmDisconnect", &api.disconnect},
			{"dcgmGroupCreate", &api.groupCreate},
			{"dcgmGroupDestroy", &api.groupDestroy},
			{"dcgmGroupAddEntity", &api.groupAddEntity},
			{"dcgmFieldGroupCreate", &api.fieldGroupCreate},
			{"dcgmFieldGroupDestroy", &api.fieldGroupDestroy},
			{"dcgmWatchFields", &api.watchFields},
			{"dcgmUnwatchFields", &api.unwatchFields},
			{"dcgmGetAllSupportedDevices", &api.getAllSupportedDevs},
			{"dcgmGetLatestValuesForFields", &api.getLatestForFields},
			{"dcgmProfPause", &api.profPause},
			{"dcgmProfResume", &api.profResume},
		}
		missing := false
		for _, r := range required {
			if err := bind(r.name, r.fptr); err != nil {
				logger.Debug("DCGM symbol missing", "lib", path, "symbol", r.name, "error", err)
				missing = true
				break
			}
		}
		if missing {
			_ = purego.Dlclose(h)
			lastErr = fmt.Errorf("required symbols missing in %s", path)
			continue
		}
		// Optional DCGM 2.x profiling APIs.
		_ = bind("dcgmProfWatchFields", &api.profWatchFields)
		_ = bind("dcgmProfUnwatchFields", &api.profUnwatchFields)
		logger.Info("loaded DCGM library", "path", path)
		return api, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("libdcgm not found")
	}
	return nil, lastErr
}

func (c *liveClient) setupGroups() error {
	api := c.api
	groupName := cString(fmt.Sprintf("openlit_dcgm_%d", os.Getpid()))
	if rc := api.groupCreate(c.handle, dcgmGroupEmpty, &groupName[0], &c.groupID); rc != dcgmSTOK {
		return fmt.Errorf("dcgmGroupCreate: %d", rc)
	}

	var gpuList [dcgmMaxNumDevices]uint32
	var count int32
	if rc := api.getAllSupportedDevs(c.handle, &gpuList, &count); rc != dcgmSTOK {
		return fmt.Errorf("dcgmGetAllSupportedDevices: %d", rc)
	}
	if count <= 0 {
		return fmt.Errorf("no DCGM-supported GPUs")
	}
	for i := int32(0); i < count; i++ {
		id := gpuList[i]
		if rc := api.groupAddEntity(c.handle, c.groupID, dcgmFEGpu, id); rc != dcgmSTOK {
			c.logger.Warn("dcgmGroupAddEntity failed", "gpu", id, "rc", rc)
			continue
		}
		c.gpuIDs = append(c.gpuIDs, uint(id))
	}
	if len(c.gpuIDs) == 0 {
		return fmt.Errorf("failed to add any GPUs to DCGM group")
	}

	fgName := cString(fmt.Sprintf("openlit_dcgm_fields_%d", os.Getpid()))
	if rc := api.fieldGroupCreate(c.handle, int32(len(c.fieldPtrs)), &c.fieldPtrs[0], &fgName[0], &c.fieldGroupID); rc != dcgmSTOK {
		return fmt.Errorf("dcgmFieldGroupCreate: %d", rc)
	}

	updateFreq := c.interval.Microseconds()
	if updateFreq <= 0 {
		updateFreq = 10_000_000
	}
	if rc := api.watchFields(c.handle, c.groupID, c.fieldGroupID, updateFreq, maxKeepAgeSec, maxKeepSamples); rc != dcgmSTOK {
		return fmt.Errorf("dcgmWatchFields: %d", rc)
	}

	_, prof := SplitProfFields(c.fields)
	if len(prof) > 0 && api.profWatchFields != nil {
		// DCGM 2.x: also register via dcgmProfWatchFields.
		watch := make([]byte, 80)
		binary.LittleEndian.PutUint32(watch[0:], uint32(80)|(1<<24)) // version
		putUintptr(watch[8:], c.groupID)
		binary.LittleEndian.PutUint32(watch[16:], uint32(len(prof)))
		for i, id := range prof {
			if i >= 16 {
				break
			}
			binary.LittleEndian.PutUint16(watch[20+i*2:], id)
		}
		binary.LittleEndian.PutUint64(watch[56:], uint64(updateFreq))
		binary.LittleEndian.PutUint64(watch[64:], math.Float64bits(maxKeepAgeSec))
		binary.LittleEndian.PutUint32(watch[72:], uint32(maxKeepSamples))
		// flags at 76 already 0
		if rc := api.profWatchFields(c.handle, unsafe.Pointer(&watch[0])); rc != dcgmSTOK {
			c.logger.Warn("dcgmProfWatchFields failed; continuing without dedicated prof watch", "rc", rc)
			c.profEnabled = false
		}
	}

	return nil
}

func (c *liveClient) Available() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return !c.closed && c.handle != 0
}

func (c *liveClient) Sample() ([]Sample, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.handle == 0 {
		return nil, nil
	}

	paused := c.pause.Paused()
	if !paused && c.profPaused {
		if c.api.profResume != nil {
			if rc := c.api.profResume(c.handle); rc != dcgmSTOK {
				c.logger.Warn("auto dcgmProfResume failed", "rc", rc)
			}
		}
		c.profPaused = false
	}

	out := make([]Sample, 0, len(c.gpuIDs))
	valuesBuf := make([]byte, dcgmFieldValueSize*len(c.fieldPtrs))

	for _, gpuID := range c.gpuIDs {
		for i := range valuesBuf {
			valuesBuf[i] = 0
		}
		// Pre-set version on each slot.
		for i := range c.fieldPtrs {
			off := i * dcgmFieldValueSize
			binary.LittleEndian.PutUint32(valuesBuf[off:], dcgmFieldValueVersion1)
		}

		rc := c.api.getLatestForFields(c.handle, int32(gpuID), &c.fieldPtrs[0], uint32(len(c.fieldPtrs)), unsafe.Pointer(&valuesBuf[0]))
		if rc != dcgmSTOK {
			return out, fmt.Errorf("dcgmGetLatestValuesForFields gpu=%d: %d", gpuID, rc)
		}

		s := Sample{
			GPUID:    gpuID,
			DeviceID: fmt.Sprintf("dcgm-%d", gpuID),
			Values:   make(map[string]float64),
		}

		for i, fieldID := range c.fieldPtrs {
			off := i * dcgmFieldValueSize
			fvFieldID := binary.LittleEndian.Uint16(valuesBuf[off+4:])
			fvType := binary.LittleEndian.Uint16(valuesBuf[off+6:])
			status := int32(binary.LittleEndian.Uint32(valuesBuf[off+8:]))
			if status != dcgmSTOK {
				continue
			}
			if fvFieldID == 0 {
				fvFieldID = fieldID
			}

			if (paused || c.profPaused || !c.profEnabled) && IsProfField(fvFieldID) {
				continue
			}

			valOff := off + 24
			switch fvType {
			case dcgmFTDouble:
				bits := binary.LittleEndian.Uint64(valuesBuf[valOff:])
				v := math.Float64frombits(bits)
				if isFP64Blank(v) {
					s.Blank = true
					continue
				}
				if key, ok := FieldIDToMetric[fvFieldID]; ok {
					s.Values[key] = v
				}
			case dcgmFTInt64:
				v := int64(binary.LittleEndian.Uint64(valuesBuf[valOff:]))
				if isInt64Blank(v) {
					s.Blank = true
					continue
				}
				if key, ok := FieldIDToMetric[fvFieldID]; ok {
					s.Values[key] = float64(v)
				}
			case dcgmFTString:
				str := cstrFromBytes(valuesBuf[valOff : valOff+dcgmMaxStrLength])
				if fvFieldID == FieldUUID && str != "" {
					s.DeviceID = str
				}
			}
		}
		out = append(out, s)
	}
	return out, nil
}

func (c *liveClient) PauseProfiling(duration time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.handle == 0 {
		return nil
	}
	c.pause.Pause(duration)
	if c.api.profPause != nil {
		if rc := c.api.profPause(c.handle); rc != dcgmSTOK {
			c.logger.Warn("dcgmProfPause failed", "rc", rc)
			return fmt.Errorf("dcgmProfPause: %d", rc)
		}
	}
	c.profPaused = true
	return nil
}

func (c *liveClient) ResumeProfiling() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.handle == 0 {
		return nil
	}
	c.pause.Resume()
	if c.api.profResume != nil {
		if rc := c.api.profResume(c.handle); rc != dcgmSTOK {
			c.logger.Warn("dcgmProfResume failed", "rc", rc)
			return fmt.Errorf("dcgmProfResume: %d", rc)
		}
	}
	c.profPaused = false
	return nil
}

func (c *liveClient) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	api := c.api
	if api == nil {
		return nil
	}

	if c.groupID != 0 && api.profUnwatchFields != nil {
		buf := make([]byte, 24)
		binary.LittleEndian.PutUint32(buf[0:], uint32(24)|(1<<24))
		putUintptr(buf[8:], c.groupID)
		_ = api.profUnwatchFields(c.handle, unsafe.Pointer(&buf[0]))
	}
	if c.groupID != 0 && c.fieldGroupID != 0 && api.unwatchFields != nil {
		_ = api.unwatchFields(c.handle, c.groupID, c.fieldGroupID)
	}
	if c.fieldGroupID != 0 && api.fieldGroupDestroy != nil {
		_ = api.fieldGroupDestroy(c.handle, c.fieldGroupID)
	}
	if c.groupID != 0 && api.groupDestroy != nil {
		_ = api.groupDestroy(c.handle, c.groupID)
	}
	if c.handle != 0 {
		if c.standalone {
			_ = api.disconnect(c.handle)
		} else {
			_ = api.stopEmbedded(c.handle)
		}
	}
	_ = api.shutdown()
	if api.handle != 0 {
		_ = purego.Dlclose(api.handle)
	}
	c.handle = 0
	return nil
}

func cString(s string) []byte {
	b := make([]byte, len(s)+1)
	copy(b, s)
	return b
}

func cstrFromBytes(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

func putUintptr(b []byte, v uintptr) {
	if len(b) < 8 {
		return
	}
	binary.LittleEndian.PutUint64(b, uint64(v))
}

func isFP64Blank(v float64) bool {
	return v >= dcgmFP64Blank || math.IsNaN(v)
}

func isInt64Blank(v int64) bool {
	return v >= dcgmInt64Blank
}
