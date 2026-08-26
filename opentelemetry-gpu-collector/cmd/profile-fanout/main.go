// Command profile-fanout triggers on-demand GPU (and optional CPU PT) profiles
// across multiple collector nodes. Idle cost on collectors is zero; this tool
// only issues short HTTP requests.
//
// Example:
//
//	profile-fanout --hosts node1,node2 --port 1919 --token "$TOKEN" --duration-ms 500
//	profile-fanout --hosts node1 --profile cpu-pt --duration-ms 200
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

func main() {
	hostsFlag := flag.String("hosts", "", "Comma-separated hostnames (or use --job-id with SLURM)")
	jobID := flag.String("job-id", "", "SLURM job id (uses squeue/scontrol to resolve hosts)")
	port := flag.Int("port", 1919, "Collector control HTTP port on each host (default matches OTEL_GPU_CONTROL_ADDR)")
	token := flag.String("token", os.Getenv("OTEL_GPU_CONTROL_TOKEN"), "Bearer token for control API")
	durationMS := flag.Uint64("duration-ms", 500, "Profile duration in milliseconds")
	profile := flag.String("profile", "gpu", "Profile type: gpu | cpu-pt")
	scheme := flag.String("scheme", "http", "http or https")
	timeout := flag.Duration("timeout", 60*time.Second, "Per-host HTTP timeout")
	startDelayS := flag.Int("start-delay-s", 5, "Shared start delay so nodes begin near the same wall time (gpu only)")
	logFile := flag.String("log-file", "", "Optional ACTIVITIES_LOG_FILE base path on each node (gpu)")
	parallel := flag.Int("parallel", 32, "Max concurrent host requests")
	flag.Parse()

	hosts := parseHosts(*hostsFlag)
	if *jobID != "" {
		slurmHosts, err := resolveSLURMHosts(*jobID)
		if err != nil {
			fatalf("slurm hosts: %v", err)
		}
		hosts = append(hosts, slurmHosts...)
	}
	hosts = unique(hosts)
	if len(hosts) == 0 {
		fatalf("provide --hosts and/or --job-id")
	}

	client := &http.Client{Timeout: *timeout}
	var (
		wg   sync.WaitGroup
		sem  = make(chan struct{}, max(1, *parallel))
		mu   sync.Mutex
		fail int
	)

	startTimeMS := uint64(time.Now().Add(time.Duration(*startDelayS)*time.Second).UnixMilli())

	for _, host := range hosts {
		host := host
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			var err error
			switch strings.ToLower(*profile) {
			case "gpu":
				err = postGPU(client, *scheme, host, *port, *token, *durationMS, startTimeMS, *logFile)
			case "cpu-pt", "intel-pt", "pt":
				err = postCPUPT(client, *scheme, host, *port, *token, *durationMS)
			default:
				err = fmt.Errorf("unknown profile %q", *profile)
			}
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				fail++
				fmt.Fprintf(os.Stderr, "FAIL %s: %v\n", host, err)
				return
			}
			fmt.Printf("OK   %s\n", host)
		}()
	}
	wg.Wait()
	if fail > 0 {
		os.Exit(1)
	}
}

func postGPU(client *http.Client, scheme, host string, port int, token string, durationMS, startTimeMS uint64, logFile string) error {
	body := map[string]any{
		"duration_ms":   durationMS,
		"start_time_ms": startTimeMS,
	}
	if logFile != "" {
		body["log_file"] = logFile
	}
	return postJSON(client, scheme, host, port, token, "/v1/profile/gpu", body)
}

func postCPUPT(client *http.Client, scheme, host string, port int, token string, durationMS uint64) error {
	body := map[string]any{"duration_ms": durationMS}
	return postJSON(client, scheme, host, port, token, "/v1/profile/cpu/pt", body)
}

func postJSON(client *http.Client, scheme, host string, port int, token, path string, body any) error {
	u := &url.URL{
		Scheme: scheme,
		Host:   fmt.Sprintf("%s:%d", host, port),
		Path:   path,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}

func parseHosts(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func unique(in []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, h := range in {
		if _, ok := seen[h]; ok {
			continue
		}
		seen[h] = struct{}{}
		out = append(out, h)
	}
	return out
}

func resolveSLURMHosts(job string) ([]string, error) {
	squeue := "squeue"
	if p, err := exec.LookPath("squeue"); err == nil {
		squeue = p
	}
	out, err := exec.Command(squeue, "-j", job, "-h", "-o", "%N").CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("squeue: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	hostStr := strings.TrimSpace(string(out))
	if hostStr == "" {
		return nil, fmt.Errorf("no hosts for job %s", job)
	}
	if !strings.Contains(hostStr, "[") {
		return []string{hostStr}, nil
	}
	scontrol := "scontrol"
	if p, err := exec.LookPath("scontrol"); err == nil {
		scontrol = p
	}
	expanded, err := exec.Command(scontrol, "show", "hostnames", hostStr).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("scontrol: %w (%s)", err, strings.TrimSpace(string(expanded)))
	}
	return parseHosts(strings.ReplaceAll(string(expanded), "\n", ",")), nil
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(2)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
