package webhook

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/openlit/openlit/operator/internal/observability"
)

// CertificateManager handles TLS certificate generation and management for the webhook
type CertificateManager struct {
	client           kubernetes.Interface
	namespace        string
	serviceName      string
	secretName       string
	validityDays     int
	refreshThreshold int
	logger           *observability.StructuredLogger
}

// NewCertificateManager creates a new certificate manager
func NewCertificateManager(client kubernetes.Interface, namespace, serviceName, secretName string, validityDays, refreshThreshold int) *CertificateManager {
	return &CertificateManager{
		client:           client,
		namespace:        namespace,
		serviceName:      serviceName,
		secretName:       secretName,
		validityDays:     validityDays,
		refreshThreshold: refreshThreshold,
		logger:           observability.NewLogger("cert-manager"),
	}
}

// EnsureCertificate ensures that a valid TLS certificate exists for the webhook
// Following the Velotio approach: https://www.velotio.com/engineering-blog/managing-tls-certificate-for-kubernetes-admission-webhook
func (cm *CertificateManager) EnsureCertificate(ctx context.Context) ([]byte, error) {
	cm.logger.Info("🔐 Ensuring TLS certificate for webhook",
		"component", "cert-manager",
		"k8s.secret.name", cm.secretName,
		"k8s.namespace.name", cm.namespace,
		"tls.certificate.validity_days", cm.validityDays,
		"tls.certificate.refresh_threshold_days", cm.refreshThreshold)

	// Check if certificate already exists and is valid
	secret, err := cm.client.CoreV1().Secrets(cm.namespace).Get(ctx, cm.secretName, metav1.GetOptions{})
	if err == nil {
		if cm.isCertificateValid(secret) {
			cm.logger.Info("✅ Valid certificate already exists",
				"component", "cert-manager",
				"k8s.secret.name", cm.secretName)
			return secret.Data["ca.crt"], nil
		}
		cm.logger.Info("⚠️ Existing certificate is invalid, regenerating",
			"component", "cert-manager",
			"k8s.secret.name", cm.secretName,
			"reason", "certificate_expired_or_invalid")
	}

	// Generate new certificate
	caCert, caKey, err := cm.generateCACertificate()
	if err != nil {
		return nil, fmt.Errorf("failed to generate CA certificate: %w", err)
	}

	serverCert, serverKey, err := cm.generateServerCertificate(caCert, caKey)
	if err != nil {
		return nil, fmt.Errorf("failed to generate server certificate: %w", err)
	}

	// Create or update the secret
	secretData := map[string][]byte{
		"ca.crt":     caCert,
		"tls.crt":    serverCert,
		"tls.key":    serverKey,
	}

	if err := cm.createOrUpdateSecret(ctx, secretData); err != nil {
		return nil, fmt.Errorf("failed to create/update secret: %w", err)
	}

	cm.logger.Info("✅ TLS certificate generated and stored successfully",
		"component", "cert-manager",
		"k8s.secret.name", cm.secretName,
		"k8s.namespace.name", cm.namespace,
		"tls.certificate.validity_days", cm.validityDays)
	return caCert, nil
}

// generateCACertificate generates a self-signed CA certificate
func (cm *CertificateManager) generateCACertificate() ([]byte, *rsa.PrivateKey, error) {
	// Generate CA private key
	caPrivKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, err
	}

	// Create CA certificate template
	caTemplate := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: "OpenLIT Webhook CA",
		},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(time.Duration(cm.validityDays) * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}

	// Generate CA certificate
	caCertDER, err := x509.CreateCertificate(rand.Reader, &caTemplate, &caTemplate, &caPrivKey.PublicKey, caPrivKey)
	if err != nil {
		return nil, nil, err
	}

	// Encode CA certificate to PEM
	caCertPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: caCertDER,
	})

	return caCertPEM, caPrivKey, nil
}

// generateServerCertificate generates a server certificate signed by the CA
func (cm *CertificateManager) generateServerCertificate(caCertPEM []byte, caKey *rsa.PrivateKey) ([]byte, []byte, error) {
	// Parse CA certificate
	caCertBlock, _ := pem.Decode(caCertPEM)
	caCert, err := x509.ParseCertificate(caCertBlock.Bytes)
	if err != nil {
		return nil, nil, err
	}

	// Generate server private key
	serverPrivKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, err
	}

	// Create server certificate template
	serverTemplate := x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject: pkix.Name{
			CommonName: fmt.Sprintf("%s.%s.svc", cm.serviceName, cm.namespace),
		},
		NotBefore:   time.Now(),
		NotAfter:    time.Now().Add(time.Duration(cm.validityDays) * 24 * time.Hour),
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames: []string{
			cm.serviceName,
			fmt.Sprintf("%s.%s", cm.serviceName, cm.namespace),
			fmt.Sprintf("%s.%s.svc", cm.serviceName, cm.namespace),
			fmt.Sprintf("%s.%s.svc.cluster.local", cm.serviceName, cm.namespace),
		},
		IPAddresses: []net.IP{
			net.ParseIP("127.0.0.1"),
		},
	}

	// Generate server certificate
	serverCertDER, err := x509.CreateCertificate(rand.Reader, &serverTemplate, caCert, &serverPrivKey.PublicKey, caKey)
	if err != nil {
		return nil, nil, err
	}

	// Encode server certificate to PEM
	serverCertPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: serverCertDER,
	})

	// Encode server private key to PEM
	serverKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(serverPrivKey),
	})

	return serverCertPEM, serverKeyPEM, nil
}

// isCertificateValid checks if the existing certificate is still valid
func (cm *CertificateManager) isCertificateValid(secret *corev1.Secret) bool {
	certPEM, exists := secret.Data["tls.crt"]
	if !exists {
		return false
	}

	certBlock, _ := pem.Decode(certPEM)
	if certBlock == nil {
		return false
	}

	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return false
	}

	// Check if certificate is still valid (not expired and valid for at least refreshThreshold more days)
	return time.Now().Add(time.Duration(cm.refreshThreshold)*24*time.Hour).Before(cert.NotAfter)
}

// createOrUpdateSecret creates or updates the TLS secret
func (cm *CertificateManager) createOrUpdateSecret(ctx context.Context, data map[string][]byte) error {
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      cm.secretName,
			Namespace: cm.namespace,
			Labels: map[string]string{
				"app":       "openlit-operator",
				"component": "webhook-certs",
			},
		},
		Type: corev1.SecretTypeTLS,
		Data: data,
	}

	_, err := cm.client.CoreV1().Secrets(cm.namespace).Get(ctx, cm.secretName, metav1.GetOptions{})
	if err != nil {
		// Secret doesn't exist, create it
		_, err = cm.client.CoreV1().Secrets(cm.namespace).Create(ctx, secret, metav1.CreateOptions{})
		return err
	}

	// Secret exists, update it
	_, err = cm.client.CoreV1().Secrets(cm.namespace).Update(ctx, secret, metav1.UpdateOptions{})
	return err
}

// GetTLSConfig returns a TLS config for the webhook server
func (cm *CertificateManager) GetTLSConfig(ctx context.Context) (*tls.Config, error) {
	secret, err := cm.client.CoreV1().Secrets(cm.namespace).Get(ctx, cm.secretName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get TLS secret: %w", err)
	}

	cert, err := tls.X509KeyPair(secret.Data["tls.crt"], secret.Data["tls.key"])
	if err != nil {
		return nil, fmt.Errorf("failed to load key pair: %w", err)
	}

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
	}, nil
}