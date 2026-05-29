// Package engine — lifecycle.go
//
// Implements the controller-side Play / Stop / Restart actions queued from
// the dashboard. The critical invariant every code path here MUST preserve
// is workload identity: an agent that gets stopped and started again must
// keep the same workload_key (see events.go::buildWorkloadKey) and the same
// service_name so the dashboard rollup re-points to the *same* agent_key
// row instead of creating a duplicate.
//
// Per-mode identity preservation rules:
//   - K8s controlled workload: scale-to-0 (preserves Deployment/STS/DS
//     object, container_name, deployment_name); rollout-restart is an
//     annotation bump on the pod template.
//   - K8s naked pod: snapshot the pod spec before delete, recreate with the
//     *same* metadata.name on Start.
//   - Docker: stopContainer / startContainer / restartContainer all run
//     against the same container ID; name + ID are stable.
//   - Linux systemd: systemctl start/stop/restart of the same unit name.
//   - Linux bare process: capture (exe, args, cwd, env-allowlist) before
//     SIGTERM; re-exec with the same args produces an identical
//     sha1(exe|cmdline) fingerprint.

package engine

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
	"go.uber.org/zap"
)

// lifecycleBareProcessSnapshot is what we persist into the desired-state
// config blob on Stop for a Linux bare process so Start can re-exec it
// identically. The workload_key fingerprint that the dashboard rolls up
// on is sha1(/proc/PID/exe-resolved | argv-cmdline), so the only fields
// we strictly need to preserve identity are Args (argv) and the runtime
// binary path that PATH resolution lands on for Args[0]. Cwd is needed
// to give relative argv[0]s the same starting directory. The env
// allowlist intentionally excludes arbitrary user env to avoid leaking
// secrets through the dashboard.
//
// ExePath here is captured from argv[0] (i.e. the launch path the user
// typed) rather than the resolved /proc/PID/exe symlink — it is purely
// informational metadata for operators reading the desired-state row.
// launchBareProcess relies on Args + Cwd to recreate identical argv +
// PATH resolution on Start.
type lifecycleBareProcessSnapshot struct {
	ExePath string            `json:"exe_path"`
	Args    []string          `json:"args"`
	Cwd     string            `json:"cwd"`
	Env     map[string]string `json:"env"`
}

// lifecycleK8sPodSnapshot wraps a gzip+base64-encoded pod spec. We
// serialize it this way because real-world pod specs can be 5-15KB; the
// desired-states config column is plain String and gets piped through
// ClickHouse JSONEachRow, so keeping it compact + ASCII-safe matters.
//
// `Controlled` is set for Deployment/StatefulSet/DaemonSet workloads so
// startK8s can re-derive the kind/namespace/name needed to scale back
// up even when the controller's in-memory service cache has been
// pruned (>30 min after Stop, or controller restart). Without it, a
// long-stopped controlled workload becomes unrecoverable from the UI.
//
// Exactly one of `Controlled` or `GzippedPodB64` is populated per
// snapshot: controlled workloads do not carry pod specs because Start
// simply patches the existing Deployment back up, and naked pods do
// not carry a Controlled struct because there is no parent object.
type lifecycleK8sPodSnapshot struct {
	GzippedPodB64 string                          `json:"gzipped_pod_b64,omitempty"`
	Controlled    *lifecycleK8sControlledSnapshot `json:"controlled,omitempty"`
}

type lifecycleK8sControlledSnapshot struct {
	Kind          string `json:"kind"`
	Namespace     string `json:"namespace"`
	Name          string `json:"name"`
	ContainerName string `json:"container_name,omitempty"`
}

// envAllowlistPrefixes captures the env vars Stop/Start should preserve
// for bare-process restart. Everything else (auth tokens, DB passwords,
// arbitrary user env) is dropped on purpose -- the controller is not a
// secret store. PATH/HOME keep the new process able to find its libs.
var envAllowlistPrefixes = []string{
	"PATH",
	"HOME",
	"LANG",
	"LC_",
	"PYTHONPATH",
	"OPENLIT_",
	"OTEL_",
}

// StartWorkload brings a previously-stopped workload back online. payload
// is the raw JSON string queued by the dashboard; for naked pods and bare
// processes it carries the snapshot captured at Stop time.
func (e *Engine) StartWorkload(workloadKey, payload string) error {
	svc, err := e.snapshotService(workloadKey)
	if err != nil {
		// For K8s naked pods + Linux bare processes the service is gone
		// from e.services by the time Start arrives (Stop removed it).
		// We still need to act, but with only the workload_key and the
		// payload to go on. The payload carries the snapshot in those
		// cases; for other modes we cannot proceed without an in-memory
		// service entry.
		if isModeRequiringInMemory(e.deployMode) {
			return err
		}
	}

	switch e.deployMode {
	case config.DeployKubernetes:
		return e.startK8s(workloadKey, svc, payload)
	case config.DeployDocker:
		if svc == nil {
			return fmt.Errorf("docker workload %q not in scanner cache", workloadKey)
		}
		return e.startDocker(svc)
	default:
		return e.startLinux(workloadKey, svc, payload)
	}
}

// StopWorkload takes a running workload offline. The returned snapshot is
// included in the ActionResult so the dashboard can persist it into
// desired_states_v2.config and feed it back on the next Start.
func (e *Engine) StopWorkload(workloadKey, _ string) (string, error) {
	svc, err := e.snapshotService(workloadKey)
	if err != nil {
		return "", err
	}

	switch e.deployMode {
	case config.DeployKubernetes:
		return e.stopK8s(svc)
	case config.DeployDocker:
		return "", e.stopDocker(svc)
	default:
		return e.stopLinux(svc)
	}
}

// RestartWorkload is identity-preserving: pod names / container IDs /
// systemd unit names are unchanged across the operation.
func (e *Engine) RestartWorkload(workloadKey, _ string) error {
	svc, err := e.snapshotService(workloadKey)
	if err != nil {
		return err
	}

	switch e.deployMode {
	case config.DeployKubernetes:
		return e.restartK8s(svc)
	case config.DeployDocker:
		return e.restartDocker(svc)
	default:
		return e.restartLinux(svc)
	}
}

func isModeRequiringInMemory(mode config.DeployMode) bool {
	// For K8s the dashboard-supplied payload + workload_key are enough to
	// recreate naked pods; controlled workloads can be looked up directly
	// from the API server. For Linux bare we likewise need only the
	// payload + workload_key. Docker is the odd one out: Start runs
	// against a stopped container, and we need its current container.id
	// from the local scanner cache to issue the start.
	return mode == config.DeployDocker
}

// ----- Kubernetes ---------------------------------------------------------

func (e *Engine) stopK8s(svc *openlit.ServiceState) (string, error) {
	if e.container == nil || e.container.k8sClient == nil {
		return "", fmt.Errorf("kubernetes client unavailable for lifecycle stop")
	}
	namespace := svc.ResourceAttributes["k8s.namespace.name"]
	workloadKind := svc.ResourceAttributes["k8s.workload.kind"]
	workloadName := svc.DeploymentName
	if workloadKind == "" || workloadKind == "Pod" {
		return e.stopK8sNakedPod(svc)
	}
	if namespace == "" || workloadName == "" {
		return "", fmt.Errorf("missing k8s workload metadata for %s", svc.ServiceName)
	}
	if err := e.container.k8sClient.atomicScaleWithAnnotation(
		namespace, workloadKind, workloadName, 0, K8sSavedReplicasAnnotation,
	); err != nil {
		return "", err
	}
	e.setLifecycleState(svc.WorkloadKey, LifecycleStatusStopped)
	e.logger.Info("k8s workload stopped",
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("kind", workloadKind),
		zap.String("name", workloadName),
	)
	// Persist a small identifier blob so a later Start can re-derive
	// (kind, ns, name) without depending on the controller's in-memory
	// cache — which gets pruned after 30 min, or wiped entirely on
	// controller restart.
	snap := lifecycleK8sPodSnapshot{
		Controlled: &lifecycleK8sControlledSnapshot{
			Kind:          workloadKind,
			Namespace:     namespace,
			Name:          workloadName,
			ContainerName: svc.ResourceAttributes["container.name"],
		},
	}
	out, err := json.Marshal(snap)
	if err != nil {
		// The scale already happened; losing the snapshot just degrades
		// recovery, it doesn't undo Stop. Return success so the action
		// completes and the UI reflects the stopped state.
		e.logger.Warn("k8s controlled snapshot marshal failed",
			zap.String("workload_key", svc.WorkloadKey),
			zap.Error(err),
		)
		return "", nil
	}
	return string(out), nil
}

func (e *Engine) startK8s(workloadKey string, svc *openlit.ServiceState, payload string) error {
	if e.container == nil || e.container.k8sClient == nil {
		return fmt.Errorf("kubernetes client unavailable for lifecycle start")
	}

	// Dispatch order:
	//   1. If the payload carries a parsed snapshot, trust it. This is
	//      the durable source of truth — it survives controller cache
	//      eviction and controller restarts.
	//   2. Else fall back to the in-memory svc (fresh Stop→Play within
	//      the prune window).
	//   3. Else (no payload, no svc) we're out of options — fail
	//      explicitly so the user sees a clear error.
	if payload != "" && payload != "{}" {
		var parsed lifecycleK8sPodSnapshot
		if err := json.Unmarshal([]byte(payload), &parsed); err == nil {
			if parsed.Controlled != nil {
				return e.startK8sControlledFromSnapshot(workloadKey, parsed.Controlled)
			}
			if parsed.GzippedPodB64 != "" {
				return e.startK8sNakedPod(workloadKey, svc, payload)
			}
		}
	}

	if svc != nil && (svc.ResourceAttributes["k8s.workload.kind"] != "" && svc.ResourceAttributes["k8s.workload.kind"] != "Pod") {
		return e.startK8sControlledFromSnapshot(workloadKey, &lifecycleK8sControlledSnapshot{
			Kind:      svc.ResourceAttributes["k8s.workload.kind"],
			Namespace: svc.ResourceAttributes["k8s.namespace.name"],
			Name:      svc.DeploymentName,
		})
	}

	// Naked pod path. svc may be nil here (the pod was deleted on Stop).
	return e.startK8sNakedPod(workloadKey, svc, payload)
}

// startK8sControlledFromSnapshot scales a Deployment/STS/DS workload
// back up using the saved-replicas annotation, given just its
// (kind, namespace, name). Works whether or not the controller has
// the workload in its in-memory cache.
func (e *Engine) startK8sControlledFromSnapshot(workloadKey string, snap *lifecycleK8sControlledSnapshot) error {
	if snap == nil || snap.Kind == "" || snap.Namespace == "" || snap.Name == "" {
		return fmt.Errorf("controlled snapshot missing kind/namespace/name (workload %s)", workloadKey)
	}
	saved, err := e.container.k8sClient.readSavedReplicas(
		snap.Namespace, snap.Kind, snap.Name, K8sSavedReplicasAnnotation,
	)
	if err != nil {
		return err
	}
	if err := e.container.k8sClient.atomicScaleWithAnnotation(
		snap.Namespace, snap.Kind, snap.Name, saved, K8sSavedReplicasAnnotation,
	); err != nil {
		return err
	}
	e.setLifecycleState(workloadKey, LifecycleStatusRunning)
	e.logger.Info("k8s workload scaled back up",
		zap.String("workload_key", workloadKey),
		zap.String("kind", snap.Kind),
		zap.String("name", snap.Name),
		zap.Int("replicas", saved),
	)
	return nil
}

func (e *Engine) restartK8s(svc *openlit.ServiceState) error {
	if e.container == nil || e.container.k8sClient == nil {
		return fmt.Errorf("kubernetes client unavailable for lifecycle restart")
	}
	namespace := svc.ResourceAttributes["k8s.namespace.name"]
	workloadKind := svc.ResourceAttributes["k8s.workload.kind"]
	workloadName := svc.DeploymentName
	if workloadKind == "" || workloadKind == "Pod" {
		return e.restartK8sNakedPod(svc)
	}
	stamp := time.Now().UTC().Format(time.RFC3339)
	if err := e.container.k8sClient.bumpRolloutAnnotation(
		namespace, workloadKind, workloadName, K8sRolloutRestartAnnotation, stamp,
	); err != nil {
		return err
	}
	e.setLifecycleState(svc.WorkloadKey, LifecycleStatusRestarting)
	e.logger.Info("k8s workload restart triggered",
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("kind", workloadKind),
		zap.String("name", workloadName),
		zap.String("stamp", stamp),
	)
	return nil
}

func (e *Engine) stopK8sNakedPod(svc *openlit.ServiceState) (string, error) {
	namespace := svc.ResourceAttributes["k8s.namespace.name"]
	podName := svc.ResourceAttributes["k8s.pod.name"]
	if namespace == "" || podName == "" {
		return "", fmt.Errorf("naked pod %s missing namespace or pod name", svc.ServiceName)
	}
	pod, err := e.container.k8sClient.getPod(namespace, podName)
	if err != nil {
		return "", err
	}
	stripPodRuntimeFields(pod)
	blob, err := encodePodSnapshot(pod)
	if err != nil {
		return "", err
	}
	if err := e.container.k8sClient.deletePod(namespace, podName, 0); err != nil {
		return "", err
	}
	e.setLifecycleState(svc.WorkloadKey, LifecycleStatusStopped)
	e.logger.Info("k8s naked pod stopped",
		zap.String("workload_key", svc.WorkloadKey),
		zap.String("namespace", namespace),
		zap.String("pod", podName),
	)
	return blob, nil
}

func (e *Engine) startK8sNakedPod(workloadKey string, svc *openlit.ServiceState, payload string) error {
	if payload == "" || payload == "{}" {
		return fmt.Errorf("naked pod start requires a snapshot payload (workload %s)", workloadKey)
	}
	pod, err := decodePodSnapshot(payload)
	if err != nil {
		return err
	}
	namespace := podMetaString(pod, "namespace")
	podName := podMetaString(pod, "name")
	if namespace == "" || podName == "" {
		return fmt.Errorf("naked pod snapshot missing namespace or name (workload %s)", workloadKey)
	}
	stripPodRuntimeFields(pod)
	if err := e.container.k8sClient.createPod(namespace, pod); err != nil {
		return err
	}
	// At this point the scanner will rediscover the pod and re-populate
	// e.services. We still seed the lifecycle status so the next poll
	// reports "running" even if it lands before the rediscovery.
	if svc != nil {
		e.setLifecycleState(workloadKey, LifecycleStatusRunning)
	}
	e.logger.Info("k8s naked pod started",
		zap.String("workload_key", workloadKey),
		zap.String("namespace", namespace),
		zap.String("pod", podName),
	)
	return nil
}

func (e *Engine) restartK8sNakedPod(svc *openlit.ServiceState) error {
	blob, err := e.stopK8sNakedPod(svc)
	if err != nil {
		return err
	}
	if err := e.startK8sNakedPod(svc.WorkloadKey, svc, blob); err != nil {
		return err
	}
	e.setLifecycleState(svc.WorkloadKey, LifecycleStatusRunning)
	return nil
}

func encodePodSnapshot(pod map[string]any) (string, error) {
	raw, err := json.Marshal(pod)
	if err != nil {
		return "", fmt.Errorf("marshal pod snapshot: %w", err)
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(raw); err != nil {
		_ = gz.Close()
		return "", fmt.Errorf("gzip pod snapshot: %w", err)
	}
	if err := gz.Close(); err != nil {
		return "", fmt.Errorf("gzip close: %w", err)
	}
	wrapped := lifecycleK8sPodSnapshot{
		GzippedPodB64: base64.StdEncoding.EncodeToString(buf.Bytes()),
	}
	out, err := json.Marshal(wrapped)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func decodePodSnapshot(blob string) (map[string]any, error) {
	var wrapped lifecycleK8sPodSnapshot
	if err := json.Unmarshal([]byte(blob), &wrapped); err != nil {
		return nil, fmt.Errorf("parse pod snapshot wrapper: %w", err)
	}
	if wrapped.GzippedPodB64 == "" {
		return nil, fmt.Errorf("pod snapshot missing gzipped body")
	}
	gzBytes, err := base64.StdEncoding.DecodeString(wrapped.GzippedPodB64)
	if err != nil {
		return nil, fmt.Errorf("decode pod snapshot: %w", err)
	}
	gz, err := gzip.NewReader(bytes.NewReader(gzBytes))
	if err != nil {
		return nil, fmt.Errorf("gunzip pod snapshot: %w", err)
	}
	defer gz.Close()
	var pod map[string]any
	if err := json.NewDecoder(gz).Decode(&pod); err != nil {
		return nil, fmt.Errorf("decode pod snapshot body: %w", err)
	}
	return pod, nil
}

func podMetaString(pod map[string]any, key string) string {
	meta, _ := pod["metadata"].(map[string]any)
	if meta == nil {
		return ""
	}
	val, _ := meta[key].(string)
	return val
}

// ----- Docker -------------------------------------------------------------

func (e *Engine) stopDocker(svc *openlit.ServiceState) error {
	if e.container == nil || e.container.dockerClient == nil || !e.container.dockerClient.canManage() {
		return fmt.Errorf("docker client unavailable for lifecycle stop")
	}
	containerID := svc.ResourceAttributes["container.id"]
	if containerID == "" {
		return fmt.Errorf("docker workload %s missing container.id", svc.ServiceName)
	}
	if err := e.container.dockerClient.stopContainer(containerID, 10); err != nil {
		return err
	}
	e.setLifecycleState(svc.WorkloadKey, LifecycleStatusStopped)
	return nil
}

func (e *Engine) startDocker(svc *openlit.ServiceState) error {
	if e.container == nil || e.container.dockerClient == nil || !e.container.dockerClient.canManage() {
		return fmt.Errorf("docker client unavailable for lifecycle start")
	}
	containerID := svc.ResourceAttributes["container.id"]
	if containerID == "" {
		return fmt.Errorf("docker workload %s missing container.id", svc.ServiceName)
	}
	if err := e.container.dockerClient.startContainer(containerID); err != nil {
		return err
	}
	e.setLifecycleState(svc.WorkloadKey, LifecycleStatusRunning)
	return nil
}

func (e *Engine) restartDocker(svc *openlit.ServiceState) error {
	if e.container == nil || e.container.dockerClient == nil || !e.container.dockerClient.canManage() {
		return fmt.Errorf("docker client unavailable for lifecycle restart")
	}
	containerID := svc.ResourceAttributes["container.id"]
	if containerID == "" {
		return fmt.Errorf("docker workload %s missing container.id", svc.ServiceName)
	}
	if err := e.container.dockerClient.restartContainer(containerID, 10); err != nil {
		return err
	}
	e.setLifecycleState(svc.WorkloadKey, LifecycleStatusRestarting)
	return nil
}

// ----- Linux (systemd + bare process) -------------------------------------

func (e *Engine) stopLinux(svc *openlit.ServiceState) (string, error) {
	if unit := svc.ResourceAttributes["systemd.unit"]; unit != "" {
		if !linuxSystemdSDKSupported() {
			return "", fmt.Errorf("systemctl unavailable; cannot stop unit %s", unit)
		}
		if err := runSystemctl("stop", unit); err != nil {
			return "", err
		}
		e.setLifecycleState(svc.WorkloadKey, LifecycleStatusStopped)
		return "", nil
	}
	return e.stopBareProcess(svc)
}

func (e *Engine) startLinux(workloadKey string, svc *openlit.ServiceState, payload string) error {
	if svc != nil {
		if unit := svc.ResourceAttributes["systemd.unit"]; unit != "" {
			if !linuxSystemdSDKSupported() {
				return fmt.Errorf("systemctl unavailable; cannot start unit %s", unit)
			}
			if err := runSystemctl("start", unit); err != nil {
				return err
			}
			e.setLifecycleState(workloadKey, LifecycleStatusRunning)
			return nil
		}
	}
	// Bare process — workload may not be in e.services anymore.
	return e.startBareProcess(workloadKey, payload)
}

func (e *Engine) restartLinux(svc *openlit.ServiceState) error {
	if unit := svc.ResourceAttributes["systemd.unit"]; unit != "" {
		if !linuxSystemdSDKSupported() {
			return fmt.Errorf("systemctl unavailable; cannot restart unit %s", unit)
		}
		if err := runSystemctl("restart", unit); err != nil {
			return err
		}
		e.setLifecycleState(svc.WorkloadKey, LifecycleStatusRestarting)
		return nil
	}
	return e.restartBareProcess(svc)
}

func (e *Engine) stopBareProcess(svc *openlit.ServiceState) (string, error) {
	if svc.PID <= 0 {
		return "", fmt.Errorf("bare process %s has no pid; cannot stop", svc.ServiceName)
	}
	snap := captureBareProcessSnapshot(e.procRoot, svc.PID)
	blob, err := json.Marshal(snap)
	if err != nil {
		return "", fmt.Errorf("marshal bare-process snapshot: %w", err)
	}
	if err := syscall.Kill(svc.PID, syscall.SIGTERM); err != nil {
		return "", fmt.Errorf("SIGTERM pid %d: %w", svc.PID, err)
	}
	if !waitForProcessExit(svc.PID, 5*time.Second) {
		_ = syscall.Kill(svc.PID, syscall.SIGKILL)
		waitForProcessExit(svc.PID, 2*time.Second)
	}
	e.setLifecycleState(svc.WorkloadKey, LifecycleStatusStopped)
	return string(blob), nil
}

func (e *Engine) startBareProcess(workloadKey, payload string) error {
	if payload == "" || payload == "{}" {
		return fmt.Errorf("bare process start requires a snapshot payload (workload %s)", workloadKey)
	}
	var snap lifecycleBareProcessSnapshot
	if err := json.Unmarshal([]byte(payload), &snap); err != nil {
		return fmt.Errorf("decode bare-process snapshot: %w", err)
	}
	if snap.ExePath == "" || len(snap.Args) == 0 {
		return fmt.Errorf("bare process snapshot missing exe_path/args (workload %s)", workloadKey)
	}
	if err := launchBareProcess(snap); err != nil {
		return err
	}
	e.setLifecycleState(workloadKey, LifecycleStatusRunning)
	e.logger.Info("bare process re-launched",
		zap.String("workload_key", workloadKey),
		zap.String("exe", snap.ExePath),
		zap.Strings("args", snap.Args),
	)
	return nil
}

func (e *Engine) restartBareProcess(svc *openlit.ServiceState) error {
	if svc.PID <= 0 {
		return fmt.Errorf("bare process %s has no pid; cannot restart", svc.ServiceName)
	}
	envFull := readEnviron(e.procRoot, svc.PID)
	if envFull == nil {
		envFull = make(map[string]string)
	}
	if _, err := restartProcess(e.procRoot, svc.PID, envFull); err != nil {
		return err
	}
	e.setLifecycleState(svc.WorkloadKey, LifecycleStatusRestarting)
	return nil
}

// launchBareProcess re-execs a previously-stopped bare process from a
// captured snapshot. We deliberately mirror restartProcess's setsid setup so
// the new process detaches from the controller (otherwise it would die when
// the controller exits) but use os/exec rather than fork directly because the
// controller runs single-threaded in this code path.
//
// Trust model for the dynamic argv: the snapshot is captured at Stop
// time from /proc/<pid>/cmdline (trusted, locally read) and travels
// through the dashboard's ClickHouse `desired_states_v2.config`
// column. The argv is therefore only as trustworthy as ClickHouse
// write access. Two mitigations:
//
//  1. The controller already runs as a privileged process that can
//     execute container ops, pip installs, kubectl apply, etc. — so a
//     ClickHouse-write attacker has equivalent paths to RCE via the
//     existing action queue. This call site does not widen the blast
//     radius beyond the controller's existing trust boundary.
//  2. We still validate the argv defensively below to fail closed on
//     obviously-bogus payloads (empty argv, NUL bytes, empty argv[0])
//     rather than blindly forwarding to execve.
//
// Crucially, `exec.Command` does NOT spawn a shell — Go's os/exec
// invokes execve(2) directly with the argv slice, so shell
// metacharacters in any argv element are not interpreted.
func launchBareProcess(snap lifecycleBareProcessSnapshot) error {
	if err := validateBareProcessArgs(snap.Args); err != nil {
		return err
	}
	// nolint:gosec // G204: argv is taken from a controller-captured
	// snapshot of /proc/<pid>/cmdline; see the trust-model comment
	// above for why a dynamic argv here is acceptable. execve is
	// shell-free, and validateBareProcessArgs rejects malformed
	// payloads.
	cmd := exec.Command(snap.Args[0], snap.Args[1:]...)
	cmd.Dir = snap.Cwd
	envSlice := make([]string, 0, len(snap.Env))
	for k, v := range snap.Env {
		envSlice = append(envSlice, k+"="+v)
	}
	cmd.Env = envSlice
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start bare process: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// validateBareProcessArgs guards the launchBareProcess execve call
// against obviously-malformed payloads. The rules are deliberately
// minimal — we are not trying to defend against an attacker who
// already has ClickHouse write access (see the trust-model comment on
// launchBareProcess), only against:
//
//   - empty argv (would panic on Args[0])
//   - empty / NUL-containing argv[0] (execve rejects NULs and they
//     have caused surprising path-resolution behavior historically)
//   - NUL bytes anywhere in argv (same reasoning)
//
// We intentionally do NOT reject relative argv[0]: the original
// process may legitimately have been launched as `./my-script` and
// changing that on restart would break workload_key identity (which
// folds argv into its fingerprint).
func validateBareProcessArgs(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("bare process snapshot has empty argv")
	}
	if args[0] == "" {
		return fmt.Errorf("bare process snapshot has empty argv[0]")
	}
	for i, a := range args {
		if strings.ContainsRune(a, 0) {
			return fmt.Errorf("bare process snapshot argv[%d] contains NUL byte", i)
		}
	}
	return nil
}

// captureBareProcessSnapshot reads /proc/<pid>/* to build the minimum
// payload Start needs to re-exec the workload identically. The env is
// restricted to an allowlist of prefixes (PATH, OPENLIT_*, OTEL_*, etc.) so
// the controller never exfiltrates arbitrary user env (which may contain
// secrets) through the dashboard.
func captureBareProcessSnapshot(procRoot string, pid int) lifecycleBareProcessSnapshot {
	args := readCmdlineArgs(procRoot, pid)
	cwd := readCwd(procRoot, pid)
	if cwd == "" {
		cwd = "/"
	}
	env := readEnviron(procRoot, pid)
	filtered := make(map[string]string)
	for k, v := range env {
		for _, prefix := range envAllowlistPrefixes {
			if k == prefix || strings.HasPrefix(k, prefix) {
				filtered[k] = v
				break
			}
		}
	}
	exePath := ""
	if len(args) > 0 {
		exePath = args[0]
	}
	return lifecycleBareProcessSnapshot{
		ExePath: exePath,
		Args:    args,
		Cwd:     cwd,
		Env:     filtered,
	}
}
