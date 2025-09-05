package constants

import (
	"os"
	"path/filepath"
)

// Get current directory
// Get present working directory

var (
	CertificatesDirectory = filepath.Join(os.Getenv("GOPATH"), "openlit-opamp", "certs")
	CaCertPath            = CertificatesDirectory + "/cert/ca.cert.pem"
	ServerCertPath        = CertificatesDirectory + "/server/server.cert.pem"
	ServerCertKeyPath     = CertificatesDirectory + "/server/server.key.pem"
	ServerCSRPath         = CertificatesDirectory + "/server/server.csr"
	PrivateKeyPath        = CertificatesDirectory + "/private/ca.key.pem"
	ClientKeyPath         = CertificatesDirectory + "/client/client.key.pem"
	ClientCertPath        = CertificatesDirectory + "/client/client.cert.pem"
	ClientCSRPath         = CertificatesDirectory + "/client/client.csr"
)
