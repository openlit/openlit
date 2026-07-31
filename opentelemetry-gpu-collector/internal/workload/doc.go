// Package workload resolves PIDs to Kubernetes pod identity via cgroup paths.
// Optional kubelet PodResources allocation enrichment can be added later for
// zero-util allocated GPUs; utilization attribution uses cgroup → pod UID.
package workload
