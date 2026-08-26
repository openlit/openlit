package kineto

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const DefaultSocketPath = "/tmp/libkineto_unixsocket"

// Server provides on-demand Kineto config distribution.
//
// Unix socket line protocol (v1, documented for operators / tests):
//
//	Client sends one newline-terminated command per request:
//	  register <pid> <job_id>
//	  getConfig <pid>
//	  ping
//
//	Server replies with one of:
//	  OK\n                          — register / ping success
//	  CONFIG <nbytes>\n<bytes>\n    — getConfig with pending config (cleared after read)
//	  NONE\n                        — getConfig with no pending config
//	  ERR <message>\n               — parse / argument error
//
// Soft-fail: if the socket cannot be bound, Start returns an error but the
// Server remains usable for SetOnDemand (in-memory + per-pid config files).
type Server struct {
	Registry *Registry
	TraceDir string
	Socket   string
	Logger   *slog.Logger

	mu       sync.Mutex
	listener net.Listener
	cancel   context.CancelFunc
	wg       sync.WaitGroup
}

// NewServer constructs a Kineto server. Does not listen until Start.
func NewServer(traceDir, socket string, logger *slog.Logger) *Server {
	if traceDir == "" {
		traceDir = "/tmp"
	}
	if socket == "" {
		socket = DefaultSocketPath
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Server{
		Registry: NewRegistry(),
		TraceDir: traceDir,
		Socket:   socket,
		Logger:   logger,
	}
}

// Start begins the unix-socket accept loop. Soft-fail: returns bind error
// without disabling SetOnDemand.
func (s *Server) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listener != nil {
		return nil
	}

	_ = os.Remove(s.Socket)
	ln, err := net.Listen("unix", s.Socket)
	if err != nil {
		return fmt.Errorf("kineto unix socket listen %s: %w", s.Socket, err)
	}
	if err := os.Chmod(s.Socket, 0o666); err != nil {
		s.Logger.Warn("kineto socket chmod failed", "path", s.Socket, "error", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.listener = ln
	s.cancel = cancel
	s.wg.Add(1)
	go s.acceptLoop(ctx, ln)
	s.Logger.Info("kineto IPC listening", "socket", s.Socket, "trace_dir", s.TraceDir)
	return nil
}

// Close stops the IPC listener.
func (s *Server) Close() error {
	s.mu.Lock()
	cancel := s.cancel
	ln := s.listener
	s.listener = nil
	s.cancel = nil
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	var err error
	if ln != nil {
		err = ln.Close()
	}
	s.wg.Wait()
	_ = os.Remove(s.Socket)
	return err
}

func (s *Server) acceptLoop(ctx context.Context, ln net.Listener) {
	defer s.wg.Done()
	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
				s.Logger.Debug("kineto accept error", "error", err)
				return
			}
		}
		s.wg.Add(1)
		go func(c net.Conn) {
			defer s.wg.Done()
			s.handleConn(c)
		}(conn)
	}
}

func (s *Server) handleConn(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	r := bufio.NewReader(conn)
	line, err := r.ReadString('\n')
	if err != nil {
		return
	}
	line = strings.TrimSpace(line)
	parts := strings.Fields(line)
	if len(parts) == 0 {
		_, _ = conn.Write([]byte("ERR empty\n"))
		return
	}
	switch strings.ToLower(parts[0]) {
	case "ping":
		_, _ = conn.Write([]byte("OK\n"))
	case "register":
		if len(parts) < 3 {
			_, _ = conn.Write([]byte("ERR register needs pid job_id\n"))
			return
		}
		pid, err1 := strconv.Atoi(parts[1])
		jobID, err2 := strconv.ParseInt(parts[2], 10, 64)
		if err1 != nil || err2 != nil || pid <= 0 {
			_, _ = conn.Write([]byte("ERR bad pid or job_id\n"))
			return
		}
		s.Registry.Register(pid, jobID)
		_, _ = conn.Write([]byte("OK\n"))
	case "getconfig":
		if len(parts) < 2 {
			_, _ = conn.Write([]byte("ERR getConfig needs pid\n"))
			return
		}
		pid, err := strconv.Atoi(parts[1])
		if err != nil || pid <= 0 {
			_, _ = conn.Write([]byte("ERR bad pid\n"))
			return
		}
		s.Registry.Touch(pid)
		cfg, ok := s.Registry.TakeConfig(pid)
		if !ok || cfg == "" {
			_, _ = conn.Write([]byte("NONE\n"))
			return
		}
		_, _ = fmt.Fprintf(conn, "CONFIG %d\n%s\n", len(cfg), cfg)
	default:
		_, _ = conn.Write([]byte("ERR unknown\n"))
	}
}

// SetOnDemand matches clients, stores per-PID configs (memory + files), and
// returns matched PIDs plus artifact trace paths.
//
// Explicit request PIDs (and GPU-active children of launchers) are registered
// for jobID so the control API works without a prior IPC register handshake.
func (s *Server) SetOnDemand(jobID int64, pids []int, config string, limit int, gpuPIDs []int32) (matched []int, paths []string) {
	gpuSet := make(map[int]struct{}, len(gpuPIDs))
	for _, p := range gpuPIDs {
		gpuSet[int(p)] = struct{}{}
	}

	if len(pids) == 0 {
		for pid := range gpuSet {
			s.Registry.Register(pid, jobID)
		}
	} else {
		for _, pid := range pids {
			if pid <= 0 {
				continue
			}
			s.Registry.Register(pid, jobID)
			for _, child := range childrenOf(pid) {
				if _, ok := gpuSet[child]; ok {
					s.Registry.Register(child, jobID)
				}
			}
		}
	}

	matched, _ = Match(s.Registry, gpuPIDs, pids, jobID)
	if limit > 0 && len(matched) > limit {
		matched = matched[:limit]
	}
	if len(matched) == 0 {
		return nil, nil
	}

	baseLog := extractLogFile(config)
	if baseLog == "" {
		baseLog = filepath.Join(s.TraceDir, "libkineto_trace.json")
	}

	_ = os.MkdirAll(s.TraceDir, 0o755)

	for _, pid := range matched {
		path := TracePathForPID(baseLog, pid)
		paths = append(paths, path)
		cfg := RewriteLogFile(config, path)
		s.Registry.SetConfig([]int{pid}, cfg)
		confPath := filepath.Join(s.TraceDir, fmt.Sprintf("kineto_ondemand_%d.conf", pid))
		if err := os.WriteFile(confPath, []byte(cfg), 0o644); err != nil {
			s.Logger.Warn("kineto write ondemand conf failed",
				"pid", sanitizeLog(strconv.Itoa(pid)),
				"path", sanitizeLog(confPath),
				"error", err,
			)
		}
	}
	s.Logger.Info("kineto on-demand config set",
		"matched", len(matched),
		"job_id", sanitizeLog(strconv.FormatInt(jobID, 10)),
		"paths", sanitizeLogStrings(paths),
	)
	return matched, paths
}

func extractLogFile(config string) string {
	for _, line := range strings.Split(config, "\n") {
		if strings.HasPrefix(line, "ACTIVITIES_LOG_FILE=") {
			return strings.TrimPrefix(line, "ACTIVITIES_LOG_FILE=")
		}
	}
	return ""
}

func sanitizeLog(s string) string {
	s = strings.ReplaceAll(s, "\n", "")
	return strings.ReplaceAll(s, "\r", "")
}

func sanitizeLogStrings(in []string) []string {
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = sanitizeLog(s)
	}
	return out
}
