package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type DeployMode string

const (
	DeployLinux      DeployMode = "linux"
	DeployDocker     DeployMode = "docker"
	DeployKubernetes DeployMode = "kubernetes"
)

type Config struct {
	OpenlitURL    string        `yaml:"openlit_url"`
	APIKey        string        `yaml:"api_key"`
	APIListen     string        `yaml:"api_listen"`
	PollInterval  time.Duration `yaml:"poll_interval"`
	OBIBinaryPath string        `yaml:"obi_binary_path"`
	OTLPEndpoint  string        `yaml:"otlp_endpoint"`
	ProcRoot      string        `yaml:"proc_root"`
	Environment   string        `yaml:"environment"`
	ClusterID     string        `yaml:"cluster_id"`
	SDKVersion    string        `yaml:"sdk_version"`
	DeployMode    DeployMode    `yaml:"-"`
}

func DetectDeployMode() DeployMode {
	if _, err := os.Stat("/var/run/secrets/kubernetes.io/serviceaccount"); err == nil {
		return DeployKubernetes
	}
	if _, err := os.Stat("/var/run/docker.sock"); err == nil {
		return DeployDocker
	}
	return DeployLinux
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		APIListen:     ":4321",
		PollInterval:  60 * time.Second,
		OBIBinaryPath: "/usr/local/bin/obi",
		OTLPEndpoint:  "http://localhost:4318",
		ProcRoot:      "/proc",
	}

	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			if !os.IsNotExist(err) {
				return nil, fmt.Errorf("reading config %s: %w", path, err)
			}
		} else {
			if err := yaml.Unmarshal(data, cfg); err != nil {
				return nil, fmt.Errorf("parsing config %s: %w", path, err)
			}
		}
	}

	if v := os.Getenv("OPENLIT_URL"); v != "" {
		cfg.OpenlitURL = v
	}
	if v := os.Getenv("OPENLIT_API_KEY"); v != "" {
		cfg.APIKey = v
	}
	if v := os.Getenv("OPENLIT_API_LISTEN"); v != "" {
		cfg.APIListen = v
	}
	if v := os.Getenv("OPENLIT_POLL_INTERVAL"); v != "" {
		d, err := time.ParseDuration(v)
		if err == nil && d > 0 {
			cfg.PollInterval = d
		}
	}
	if v := os.Getenv("OPENLIT_OBI_PATH"); v != "" {
		cfg.OBIBinaryPath = v
	}
	if v := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"); v != "" {
		cfg.OTLPEndpoint = v
	}
	if v := os.Getenv("OPENLIT_PROC_ROOT"); v != "" {
		cfg.ProcRoot = v
	}
	if v := os.Getenv("OPENLIT_ENVIRONMENT"); v != "" {
		cfg.Environment = v
	} else if v := os.Getenv("OTEL_DEPLOYMENT_ENVIRONMENT"); v != "" {
		cfg.Environment = v
	}
	if cfg.Environment == "" {
		cfg.Environment = "default"
	}

	if v := os.Getenv("OPENLIT_CLUSTER_ID"); v != "" {
		cfg.ClusterID = v
	}
	if cfg.ClusterID == "" {
		cfg.ClusterID = "default"
	}

	if v := os.Getenv("OPENLIT_SDK_VERSION"); v != "" {
		cfg.SDKVersion = v
	}

	cfg.OpenlitURL = strings.TrimRight(cfg.OpenlitURL, "/")
	if v := os.Getenv("OPENLIT_DEPLOY_MODE"); v != "" {
		mode := DeployMode(v)
		switch mode {
		case DeployLinux, DeployDocker, DeployKubernetes:
			cfg.DeployMode = mode
		default:
			return nil, fmt.Errorf("unknown OPENLIT_DEPLOY_MODE %q (must be linux, docker, or kubernetes)", v)
		}
	} else {
		cfg.DeployMode = DetectDeployMode()
	}

	if cfg.OpenlitURL == "" {
		return nil, fmt.Errorf("openlit_url is required (set via config file or OPENLIT_URL env var)")
	}

	return cfg, nil
}
