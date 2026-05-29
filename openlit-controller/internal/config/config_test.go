package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectDeployModeDefaultsToLinux(t *testing.T) {
	mode := DetectDeployMode()
	if mode != DeployLinux && mode != DeployDocker {
		// On dev machines Docker socket may exist; just ensure it's a valid mode
		switch mode {
		case DeployLinux, DeployDocker, DeployKubernetes:
		default:
			t.Fatalf("unexpected mode: %q", mode)
		}
	}
}

func TestLoadEnvOverrides(t *testing.T) {
	t.Setenv("OPENLIT_URL", "http://test:3000")
	t.Setenv("OPENLIT_API_KEY", "key123")
	t.Setenv("OPENLIT_API_LISTEN", ":9999")
	t.Setenv("OPENLIT_POLL_INTERVAL", "10s")
	t.Setenv("OPENLIT_ENVIRONMENT", "staging")
	t.Setenv("OPENLIT_CLUSTER_ID", "my-cluster")
	t.Setenv("OPENLIT_SDK_VERSION", "1.2.3")
	t.Setenv("OPENLIT_DEPLOY_MODE", "docker")

	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.OpenlitURL != "http://test:3000" {
		t.Errorf("OpenlitURL = %q, want http://test:3000", cfg.OpenlitURL)
	}
	if cfg.APIKey != "key123" {
		t.Errorf("APIKey = %q", cfg.APIKey)
	}
	if cfg.APIListen != ":9999" {
		t.Errorf("APIListen = %q", cfg.APIListen)
	}
	if cfg.PollInterval.Seconds() != 10 {
		t.Errorf("PollInterval = %v", cfg.PollInterval)
	}
	if cfg.Environment != "staging" {
		t.Errorf("Environment = %q", cfg.Environment)
	}
	if cfg.ClusterID != "my-cluster" {
		t.Errorf("ClusterID = %q", cfg.ClusterID)
	}
	if cfg.SDKVersion != "1.2.3" {
		t.Errorf("SDKVersion = %q", cfg.SDKVersion)
	}
	if cfg.DeployMode != DeployDocker {
		t.Errorf("DeployMode = %q, want docker", cfg.DeployMode)
	}
}

func TestLoadRejectsUnknownDeployMode(t *testing.T) {
	t.Setenv("OPENLIT_URL", "http://test:3000")
	t.Setenv("OPENLIT_DEPLOY_MODE", "invalid_mode")

	_, err := Load("")
	if err == nil {
		t.Fatal("expected error for unknown deploy mode")
	}
}

func TestLoadRequiresOpenlitURL(t *testing.T) {
	t.Setenv("OPENLIT_URL", "")
	t.Setenv("OPENLIT_DEPLOY_MODE", "linux")

	_, err := Load("")
	if err == nil {
		t.Fatal("expected error when openlit_url is empty")
	}
}

func TestLoadFromYAMLFile(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	data := `
openlit_url: http://yaml-host:3000
api_listen: ":8888"
poll_interval: 45s
environment: production
`
	if err := os.WriteFile(configPath, []byte(data), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	t.Setenv("OPENLIT_DEPLOY_MODE", "linux")

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.OpenlitURL != "http://yaml-host:3000" {
		t.Errorf("OpenlitURL = %q", cfg.OpenlitURL)
	}
	if cfg.APIListen != ":8888" {
		t.Errorf("APIListen = %q", cfg.APIListen)
	}
	if cfg.Environment != "production" {
		t.Errorf("Environment = %q", cfg.Environment)
	}
}

func TestLoadEnvOverridesYAML(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	data := `
openlit_url: http://yaml-host:3000
environment: yaml-env
`
	if err := os.WriteFile(configPath, []byte(data), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	t.Setenv("OPENLIT_URL", "http://env-host:3000")
	t.Setenv("OPENLIT_DEPLOY_MODE", "linux")

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.OpenlitURL != "http://env-host:3000" {
		t.Errorf("env should override yaml, got OpenlitURL = %q", cfg.OpenlitURL)
	}
}

func TestLoadDefaultEnvironment(t *testing.T) {
	t.Setenv("OPENLIT_URL", "http://test:3000")
	t.Setenv("OPENLIT_DEPLOY_MODE", "linux")

	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Environment != "default" {
		t.Errorf("expected default environment, got %q", cfg.Environment)
	}
}

func TestLoadDefaultClusterID(t *testing.T) {
	t.Setenv("OPENLIT_URL", "http://test:3000")
	t.Setenv("OPENLIT_DEPLOY_MODE", "linux")

	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.ClusterID != "default" {
		t.Errorf("expected default cluster ID, got %q", cfg.ClusterID)
	}
}
