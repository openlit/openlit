//go:build linux && (amd64 || arm64)

package rdc

import (
	"fmt"
	"log/slog"
	"sync"
	"unsafe"

	"github.com/ebitengine/purego"
)

const (
	rdcSTOK              = 0
	rdcOpModeAuto        = 0
	rdcGroupDefault      = 0
	rdcMaxNumDevices     = 128
	defaultLibPath       = "librdc.so"
	altLibPath           = "librdc_bootstrap.so"
	altLibPath64         = "/opt/rocm/lib/librdc.so"
	altBootstrap         = "/opt/rocm/lib/librdc_bootstrap.so"
	updateFreqUsec       = uint64(1_000_000) // 1s
	maxKeepAgeSec        = 60.0
	maxKeepSamples       = uint32(10)
)

type rdcAPI struct {
	handle uintptr

	initFn             func(flags uint64) int32
	shutdown           func() int32
	startEmbedded      func(opMode int32, pHandle *uintptr) int32
	stopEmbedded       func(handle uintptr) int32
	deviceGetAll       func(handle uintptr, gpuList *[rdcMaxNumDevices]uint32, count *uint32) int32
	groupGPUCreate     func(handle uintptr, typ int32, name *byte, pGroup *uint32) int32
	groupGPUDestroy    func(handle uintptr, group uint32) int32
	groupFieldCreate   func(handle uintptr, num uint32, fields *uint32, name *byte, pFG *uint32) int32
	groupFieldDestroy  func(handle uintptr, fg uint32) int32
	fieldWatch         func(handle uintptr, group uint32, fg uint32, updateFreq uint64, maxKeepAge float64, maxKeepSamples uint32) int32
	fieldUnwatch       func(handle uintptr, group uint32, fg uint32) int32
	fieldGetLatest     func(handle uintptr, gpuIndex uint32, field uint32, value unsafe.Pointer) int32
}

type liveClient struct {
	api          *rdcAPI
	handle       uintptr
	groupID      uint32
	fieldGroupID uint32
	gpuIDs       []uint32
	fields       []uint32
	logger       *slog.Logger

	mu     sync.Mutex
	closed bool
}

func newPlatformClient(libPath string, logger *slog.Logger) (Client, error) {
	api, err := loadRDC(libPath, logger)
	if err != nil {
		logger.Warn("RDC library unavailable", "error", err)
		return UnavailableClient{}, nil
	}

	if api.initFn != nil {
		if rc := api.initFn(0); rc != rdcSTOK {
			logger.Warn("rdc_init failed", "rc", rc)
			cleanupAPI(api)
			return UnavailableClient{}, nil
		}
	}

	var handle uintptr
	if api.startEmbedded == nil {
		logger.Warn("rdc_start_embedded symbol missing")
		cleanupAPI(api)
		return UnavailableClient{}, nil
	}
	if rc := api.startEmbedded(rdcOpModeAuto, &handle); rc != rdcSTOK || handle == 0 {
		logger.Warn("rdc_start_embedded failed", "rc", rc)
		if api.shutdown != nil {
			_ = api.shutdown()
		}
		cleanupAPI(api)
		return UnavailableClient{}, nil
	}

	c := &liveClient{
		api:    api,
		handle: handle,
		fields: append([]uint32(nil), DefaultWatchFields...),
		logger: logger,
	}

	if err := c.setupWatch(); err != nil {
		logger.Warn("RDC field watch setup failed", "error", err)
		_ = c.Close()
		return UnavailableClient{}, nil
	}

	logger.Info("RDC profiling metrics enabled", "gpus", len(c.gpuIDs), "fields", len(c.fields))
	return c, nil
}

func cleanupAPI(api *rdcAPI) {
	if api == nil {
		return
	}
	if api.shutdown != nil {
		_ = api.shutdown()
	}
	if api.handle != 0 {
		_ = purego.Dlclose(api.handle)
		api.handle = 0
	}
}

func (c *liveClient) setupWatch() error {
	var list [rdcMaxNumDevices]uint32
	var count uint32
	if c.api.deviceGetAll == nil {
		return fmt.Errorf("rdc_device_get_all missing")
	}
	if rc := c.api.deviceGetAll(c.handle, &list, &count); rc != rdcSTOK {
		return fmt.Errorf("rdc_device_get_all rc=%d", rc)
	}
	if count == 0 {
		return fmt.Errorf("no RDC GPUs discovered")
	}
	c.gpuIDs = make([]uint32, count)
	copy(c.gpuIDs, list[:count])

	if c.api.groupGPUCreate == nil || c.api.groupFieldCreate == nil || c.api.fieldWatch == nil {
		return fmt.Errorf("required RDC group/watch symbols missing")
	}

	name := cString("openlit_rdc_gpus")
	if rc := c.api.groupGPUCreate(c.handle, rdcGroupDefault, name, &c.groupID); rc != rdcSTOK {
		return fmt.Errorf("rdc_group_gpu_create rc=%d", rc)
	}

	fields := make([]uint32, len(c.fields))
	copy(fields, c.fields)
	fgName := cString("openlit_rdc_fields")
	if rc := c.api.groupFieldCreate(c.handle, uint32(len(fields)), &fields[0], fgName, &c.fieldGroupID); rc != rdcSTOK {
		return fmt.Errorf("rdc_group_field_create rc=%d", rc)
	}

	if rc := c.api.fieldWatch(c.handle, c.groupID, c.fieldGroupID, updateFreqUsec, maxKeepAgeSec, maxKeepSamples); rc != rdcSTOK {
		return fmt.Errorf("rdc_field_watch rc=%d", rc)
	}
	return nil
}

func loadRDC(libPath string, logger *slog.Logger) (*rdcAPI, error) {
	candidates := []string{}
	if libPath != "" {
		candidates = append(candidates, libPath)
	}
	candidates = append(candidates,
		defaultLibPath, altLibPath, altLibPath64, altBootstrap,
		"librdc.so.0", "librdc_bootstrap.so.0",
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
		api := &rdcAPI{handle: h}
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
			set  func() error
		}{
			{"rdc_init", func() error { return bind("rdc_init", &api.initFn) }},
			{"rdc_start_embedded", func() error { return bind("rdc_start_embedded", &api.startEmbedded) }},
			{"rdc_device_get_all", func() error { return bind("rdc_device_get_all", &api.deviceGetAll) }},
			{"rdc_group_gpu_create", func() error { return bind("rdc_group_gpu_create", &api.groupGPUCreate) }},
			{"rdc_group_field_create", func() error { return bind("rdc_group_field_create", &api.groupFieldCreate) }},
			{"rdc_field_watch", func() error { return bind("rdc_field_watch", &api.fieldWatch) }},
			{"rdc_field_get_latest_value", func() error { return bind("rdc_field_get_latest_value", &api.fieldGetLatest) }},
		}
		missing := false
		for _, r := range required {
			if err := r.set(); err != nil {
				lastErr = fmt.Errorf("%s missing in %s: %w", r.name, path, err)
				missing = true
				break
			}
		}
		if missing {
			_ = purego.Dlclose(h)
			continue
		}
		_ = bind("rdc_shutdown", &api.shutdown)
		_ = bind("rdc_stop_embedded", &api.stopEmbedded)
		_ = bind("rdc_group_gpu_destroy", &api.groupGPUDestroy)
		_ = bind("rdc_group_field_destroy", &api.groupFieldDestroy)
		_ = bind("rdc_field_unwatch", &api.fieldUnwatch)
		logger.Info("loaded RDC library", "path", path)
		return api, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("librdc not found")
	}
	return nil, lastErr
}

func (c *liveClient) Available() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return !c.closed && c.handle != 0 && len(c.gpuIDs) > 0
}

func (c *liveClient) Sample() ([]Sample, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.handle == 0 || c.api == nil || c.api.fieldGetLatest == nil {
		return nil, nil
	}

	out := make([]Sample, 0, len(c.gpuIDs))
	buf := make([]byte, rdcFieldValueSize)

	for _, gpu := range c.gpuIDs {
		s := Sample{
			GPUID:  uint(gpu),
			Values: make(map[string]float64),
		}
		for _, field := range c.fields {
			for i := range buf {
				buf[i] = 0
			}
			rc := c.api.fieldGetLatest(c.handle, gpu, field, fieldValuePtr(buf))
			if rc != rdcSTOK {
				continue
			}
			fid, status, typ, dbl, str, ok := parseFieldValue(buf)
			if !ok || status != rdcSTOK {
				continue
			}
			if field == FieldUUID || fid == FieldUUID {
				if typ == rdcFieldTypeString && str != "" {
					s.DeviceID = str
				}
				continue
			}
			MapFieldValue(s.Values, field, dbl)
		}
		if s.DeviceID == "" {
			s.DeviceID = fmt.Sprintf("rdc-%d", gpu)
		}
		if len(s.Values) == 0 {
			continue
		}
		out = append(out, s)
	}
	return out, nil
}

func (c *liveClient) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	if c.api == nil {
		return nil
	}
	if c.handle != 0 {
		if c.api.fieldUnwatch != nil && c.groupID != 0 && c.fieldGroupID != 0 {
			_ = c.api.fieldUnwatch(c.handle, c.groupID, c.fieldGroupID)
		}
		if c.api.groupFieldDestroy != nil && c.fieldGroupID != 0 {
			_ = c.api.groupFieldDestroy(c.handle, c.fieldGroupID)
		}
		if c.api.groupGPUDestroy != nil && c.groupID != 0 {
			_ = c.api.groupGPUDestroy(c.handle, c.groupID)
		}
		if c.api.stopEmbedded != nil {
			_ = c.api.stopEmbedded(c.handle)
		}
		c.handle = 0
	}
	if c.api.shutdown != nil {
		_ = c.api.shutdown()
	}
	if c.api.handle != 0 {
		_ = purego.Dlclose(c.api.handle)
		c.api.handle = 0
	}
	return nil
}
