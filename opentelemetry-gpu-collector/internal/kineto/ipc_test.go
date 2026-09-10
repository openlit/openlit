package kineto

import (
	"bufio"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSetOnDemandAndIPC(t *testing.T) {
	dir := t.TempDir()
	sock := filepath.Join(dir, "libkineto.sock")
	s := NewServer(dir, sock, slog.Default())
	s.Registry.Register(11, 1)
	s.Registry.Register(12, 1)

	cfg := Request{
		LogFile:     filepath.Join(dir, "trace.json"),
		Mode:        TriggerDuration,
		DurationMS:  50,
		StartTimeMS: 0,
	}.ConfigText()

	matched, paths := s.SetOnDemand(1, []int{11}, cfg, 0, []int32{11, 12})
	if len(matched) != 1 || matched[0] != 11 {
		t.Fatalf("matched = %v", matched)
	}
	if len(paths) != 1 || !strings.Contains(paths[0], "_11.json") {
		t.Fatalf("paths = %v", paths)
	}
	confFile := filepath.Join(dir, "kineto_ondemand_11.conf")
	if _, err := os.Stat(confFile); err != nil {
		t.Fatalf("expected conf file: %v", err)
	}

	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	// Re-set so pending is available for getConfig.
	s.SetOnDemand(1, []int{11}, cfg, 0, []int32{11})

	conn, err := net.DialTimeout("unix", sock, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := fmt.Fprintf(conn, "getConfig 11\n"); err != nil {
		t.Fatal(err)
	}
	r := bufio.NewReader(conn)
	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(line, "CONFIG ") {
		t.Fatalf("reply: %q", line)
	}
}
