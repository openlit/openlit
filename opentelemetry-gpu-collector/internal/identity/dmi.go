package identity

import (
	"os"
	"strings"
)

// cloudProviderFromDMI reads /sys/class/dmi/id/sys_vendor when IMDS failed.
// Sets provider only — never invents host.type for bare metal.
func cloudProviderFromDMI() cloudIdentity {
	vendor, err := os.ReadFile("/sys/class/dmi/id/sys_vendor")
	if err != nil {
		return cloudIdentity{}
	}
	v := strings.ToLower(strings.TrimSpace(string(vendor)))
	switch {
	case strings.Contains(v, "amazon"):
		return cloudIdentity{Provider: "aws", Platform: "aws_ec2"}
	case strings.Contains(v, "google"):
		return cloudIdentity{Provider: "gcp", Platform: "gcp_compute_engine"}
	case strings.Contains(v, "microsoft"):
		return cloudIdentity{Provider: "azure", Platform: "azure_vm"}
	default:
		return cloudIdentity{}
	}
}
