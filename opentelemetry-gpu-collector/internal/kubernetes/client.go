package kubernetes

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"go.uber.org/zap"
)

// Client wraps Kubernetes client functionality
type Client struct {
	clientset *kubernetes.Clientset
	logger    *zap.Logger
	nodeName  string
}

// PodInfo contains information about a pod using GPU
type PodInfo struct {
	Name      string
	Namespace string
	UID       string
	GPUIndex  int
	GPUType   string
}

// NewClient creates a new Kubernetes client
func NewClient(logger *zap.Logger, kubeconfig string, inCluster bool) (*Client, error) {
	var config *rest.Config
	var err error

	if inCluster {
		// In-cluster configuration
		config, err = rest.InClusterConfig()
		if err != nil {
			return nil, fmt.Errorf("failed to create in-cluster config: %w", err)
		}
	} else {
		// Out-of-cluster configuration
		if kubeconfig == "" {
			kubeconfig = filepath.Join(os.Getenv("HOME"), ".kube", "config")
		}
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			return nil, fmt.Errorf("failed to build config from kubeconfig: %w", err)
		}
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	// Get node name
	nodeName := os.Getenv("NODE_NAME")
	if nodeName == "" {
		// Try to get node name from hostname
		hostname, err := os.Hostname()
		if err != nil {
			return nil, fmt.Errorf("failed to get hostname: %w", err)
		}
		nodeName = hostname
	}

	return &Client{
		clientset: clientset,
		logger:    logger,
		nodeName:  nodeName,
	}, nil
}

// GetNodeName returns the node name
func (c *Client) GetNodeName() string {
	return c.nodeName
}

// GetPodsWithGPU returns all pods using GPU on the current node
func (c *Client) GetPodsWithGPU(ctx context.Context) ([]PodInfo, error) {
	pods, err := c.clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: fmt.Sprintf("spec.nodeName=%s", c.nodeName),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}

	var podsWithGPU []PodInfo
	for _, pod := range pods.Items {
		// Check if pod has GPU resources
		if hasGPUResources(pod) {
			podsWithGPU = append(podsWithGPU, PodInfo{
				Name:      pod.Name,
				Namespace: pod.Namespace,
				UID:       string(pod.UID),
				GPUIndex:  getGPUIndex(pod),
				GPUType:   getGPUType(pod),
			})
		}
	}

	return podsWithGPU, nil
}

// GetNodeGPUInfo returns GPU information for the current node
func (c *Client) GetNodeGPUInfo(ctx context.Context) (*corev1.Node, error) {
	node, err := c.clientset.CoreV1().Nodes().Get(ctx, c.nodeName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get node: %w", err)
	}
	return node, nil
}

// hasGPUResources checks if a pod has GPU resources
func hasGPUResources(pod corev1.Pod) bool {
	for _, container := range pod.Spec.Containers {
		for resourceName := range container.Resources.Limits {
			if resourceName == "nvidia.com/gpu" || resourceName == "amd.com/gpu" {
				return true
			}
		}
	}
	return false
}

// getGPUIndex gets the GPU index from pod annotations
func getGPUIndex(pod corev1.Pod) int {
	// Try to get GPU index from annotations
	if index, ok := pod.Annotations["gpu-index"]; ok {
		if i, err := strconv.Atoi(index); err == nil {
			return i
		}
	}
	return 0
}

// getGPUType gets the GPU type from pod annotations
func getGPUType(pod corev1.Pod) string {
	// Try to get GPU type from annotations
	if gpuType, ok := pod.Annotations["gpu-type"]; ok {
		return gpuType
	}
	return "unknown"
} 