package certman

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io/ioutil"
	"log"
	"math/big"
	"net"
	"os"
	"sync"
	"time"

	"opamp-server/constants"

	"github.com/open-telemetry/opamp-go/protobufs"
)

var logger = log.New(log.Default().Writer(), "[CertMan] ", log.Default().Flags()|log.Lmsgprefix|log.Lmicroseconds)

var (
	caCert      *x509.Certificate
	caPrivKey   *rsa.PrivateKey
	caCertBytes []byte
)

var loadCACertOnce sync.Once

func loadCACert() {

	// Load CA certificate.
	var err error
	caCertBytes, err = ioutil.ReadFile(constants.CaCertPath)
	if err != nil {
		logger.Fatalf("Cannot read CA cert: %v", err)
	}

	caKeyBytes, err := ioutil.ReadFile(constants.PrivateKeyPath)
	if err != nil {
		logger.Fatalf("Cannot read CA key: %v", err)
	}

	// Convert from DER to PEM format.
	caCertPB, _ := pem.Decode(caCertBytes)
	caKeyPB, _ := pem.Decode(caKeyBytes)

	caCert, err = x509.ParseCertificate(caCertPB.Bytes)
	if err != nil {
		logger.Fatalf("Cannot parse CA certificate: %v", err)
	}

	caPrivKey, err = x509.ParsePKCS1PrivateKey(caKeyPB.Bytes)
	if err != nil {
		logger.Fatalf("Cannot parse CA key: %v", err)
	}
}

func createClientTLSCertTemplate() *x509.Certificate {
	return &x509.Certificate{
		SerialNumber: big.NewInt(1),
		IPAddresses:  []net.IP{net.IPv4(127, 0, 0, 1)},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(time.Hour * 1000),
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth},
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
}

func CreateClientTLSCertFromCSR(csr *x509.CertificateRequest) (*protobufs.TLSCertificate, error) {
	loadCACertOnce.Do(loadCACert)

	template := createClientTLSCertTemplate()

	// Use the Subject from CSR.
	template.Subject = csr.Subject

	// Create the client cert and sign it using CA cert.
	certBytes, err := x509.CreateCertificate(rand.Reader, template, caCert, csr.PublicKey, caPrivKey)
	if err != nil {
		err := fmt.Errorf("cannot create certificate: %v", err)
		return nil, err
	}

	// Convert from DER to PEM format.
	certPEM := new(bytes.Buffer)
	pem.Encode(
		certPEM, &pem.Block{
			Type:  "CERTIFICATE",
			Bytes: certBytes,
		},
	)

	// We have a client certificate with a public and private key.
	certificate := &protobufs.TLSCertificate{
		Cert:   certPEM.Bytes(),
		CaCert: caCertBytes,
	}

	return certificate, nil
}

func CreateClientTLSCert() (*protobufs.TLSCertificate, error) {
	loadCACertOnce.Do(loadCACert)

	// Generate a keypair for new client cert.
	clientCertKeyPair, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		err := fmt.Errorf("cannot generate keypair: %v", err)
		return nil, err
	}

	// Prepare certificate template.
	template := createClientTLSCertTemplate()
	template.Subject = pkix.Name{
		CommonName:   "OpAMP Example Client",
		Organization: []string{"OpenTelemetry OpAMP Workgroup"},
		Locality:     []string{"Server-initiated"},
	}

	// Create the client cert. Sign it using CA cert.
	certDER, err := x509.CreateCertificate(rand.Reader, template, caCert, &clientCertKeyPair.PublicKey, caPrivKey)
	if err != nil {
		err := fmt.Errorf("cannot create certificate: %v", err)
		return nil, err
	}

	certPEM := new(bytes.Buffer)
	pem.Encode(
		certPEM, &pem.Block{
			Type:  "CERTIFICATE",
			Bytes: certDER,
		},
	)

	privateKeyPEM := new(bytes.Buffer)
	pem.Encode(
		privateKeyPEM, &pem.Block{
			Type:  "RSA PRIVATE KEY",
			Bytes: x509.MarshalPKCS1PrivateKey(clientCertKeyPair),
		},
	)

	// We have a client certificate with a public and private key.
	certificate := &protobufs.TLSCertificate{
		Cert:       certPEM.Bytes(),
		PrivateKey: privateKeyPEM.Bytes(),
		CaCert:     caCertBytes,
	}

	return certificate, nil
}

func CreateServerTLSConfig(caCertPath, serverCertPath, serverKeyPath string) (*tls.Config, error) {
	// Read the CA's public key. This is the CA that signs the server's certificate.
	caCertBytes, err := os.ReadFile(caCertPath)
	if err != nil {
		return nil, err
	}

	// Create a certificate pool and make our CA trusted.
	caCertPool := x509.NewCertPool()
	if ok := caCertPool.AppendCertsFromPEM(caCertBytes); !ok {
		return nil, errors.New("cannot append ca.cert.pem")
	}

	// Load server's certificate.
	cert, err := tls.LoadX509KeyPair(
		serverCertPath,
		serverKeyPath,
	)
	if err != nil {
		return nil, fmt.Errorf("tls.LoadX509KeyPair failed: %v", err)
	}
	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		// TODO: verify client cert manually, and allow TOFU option. See manual
		// verification example: https://dev.to/living_syn/validating-client-certificate-sans-in-go-i5p
		// Instead, we use VerifyClientCertIfGiven which will automatically verify the provided certificate
		// is signed by our CA (so TOFU with self-generated client certificate will not work).
		ClientAuth: tls.VerifyClientCertIfGiven,
		// Allow insecure connections for demo purposes.
		InsecureSkipVerify: true,
		ClientCAs:          caCertPool,
	}
	return tlsConfig, nil
}

func CreateTLSCert(caCertPath, caKeyPath string) (*protobufs.TLSCertificate, error) {
	// Load CA Cert.
	caCertBytes, err := os.ReadFile(caCertPath)
	if err != nil {
		return nil, fmt.Errorf("cannot read CA cert: %v", err)
	}

	caKeyBytes, err := os.ReadFile(caKeyPath)
	if err != nil {
		return nil, fmt.Errorf("cannot read CA key: %v", err)
	}

	caCertPB, _ := pem.Decode(caCertBytes)
	caKeyPB, _ := pem.Decode(caKeyBytes)
	caCert, err := x509.ParseCertificate(caCertPB.Bytes)
	if err != nil {
		return nil, fmt.Errorf("cannot parse CA cert: %v", err)
	}

	caPrivKey, err := x509.ParsePKCS1PrivateKey(caKeyPB.Bytes)
	if err != nil {
		return nil, fmt.Errorf("cannot parse CA key: %v", err)
	}

	// Generate a private key for new client cert.
	certPrivKey, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		err := fmt.Errorf("cannot generate private key: %v", err)
		return nil, err
	}

	// Prepare certificate template.
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName:    "OpAMP Example Client",
			Organization:  []string{"OpAMP Example"},
			Country:       []string{"CA"},
			Province:      []string{"ON"},
			Locality:      []string{"City"},
			StreetAddress: []string{""},
			PostalCode:    []string{""},
		},
		IPAddresses: []net.IP{net.IPv4(127, 0, 0, 1)},
		NotBefore:   time.Now(),
		NotAfter:    time.Now().Add(time.Hour * 1000),
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth},
		KeyUsage:    x509.KeyUsageDigitalSignature,
	}

	// Create the client cert. Sign it using CA cert.
	certBytes, err := x509.CreateCertificate(rand.Reader, template, caCert, &certPrivKey.PublicKey, caPrivKey)
	if err != nil {
		err := fmt.Errorf("cannot create certificate: %v", err)
		return nil, err
	}

	publicKeyPEM := new(bytes.Buffer)
	pem.Encode(publicKeyPEM, &pem.Block{
		Type:  "CERTIFICATE",
		Bytes: certBytes,
	})

	privateKeyPEM := new(bytes.Buffer)
	pem.Encode(privateKeyPEM, &pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(certPrivKey),
	})

	// We have a client certificate with a public and private key.
	certificate := &protobufs.TLSCertificate{
		Cert:       publicKeyPEM.Bytes(),
		PrivateKey: privateKeyPEM.Bytes(),
		CaCert:     caCertBytes,
	}

	return certificate, nil
}
