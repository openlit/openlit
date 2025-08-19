package webhook

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	"github.com/openlit/openlit/operator/internal/observability"
)

type CertificateManagerTestSuite struct {
	suite.Suite
	certManager *CertificateManager
	ctx         context.Context
}

func (suite *CertificateManagerTestSuite) SetupTest() {
	// Create fake Kubernetes client
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	
	fakeClient := fake.NewClientBuilder().WithScheme(scheme).Build()

	// Create mock logger provider
	loggerProvider := &observability.LoggerProvider{
		OTLPEnabled:   false,
		OTLPEndpoint:  "",
		ErrorMessage:  "",
	}

	suite.ctx = context.Background()
	
	// Create certificate manager
	suite.certManager = NewCertificateManager(
		fakeClient,
		loggerProvider,
		"openlit-webhook",
		"openlit",
		"openlit-webhook-tls",
		"openlit-webhook.openlit.svc",
	)
}

func (suite *CertificateManagerTestSuite) TestGenerateCertificate() {
	caCert, caKey, err := suite.certManager.generateCA()
	suite.NoError(err, "Should generate CA certificate successfully")
	suite.NotEmpty(caCert, "CA certificate should not be empty")
	suite.NotEmpty(caKey, "CA private key should not be empty")

	// Verify CA certificate
	caCertPEM, _ := pem.Decode(caCert)
	suite.NotNil(caCertPEM, "Should decode CA certificate PEM")
	suite.Equal("CERTIFICATE", caCertPEM.Type)

	parsedCACert, err := x509.ParseCertificate(caCertPEM.Bytes)
	suite.NoError(err, "Should parse CA certificate")
	suite.True(parsedCACert.IsCA, "Certificate should be marked as CA")
	suite.True(parsedCACert.KeyUsage&x509.KeyUsageCertSign != 0, "Should have cert sign usage")

	// Generate server certificate
	serverCert, serverKey, err := suite.certManager.generateServerCert(caCert, caKey)
	suite.NoError(err, "Should generate server certificate successfully")
	suite.NotEmpty(serverCert, "Server certificate should not be empty")
	suite.NotEmpty(serverKey, "Server private key should not be empty")

	// Verify server certificate
	serverCertPEM, _ := pem.Decode(serverCert)
	suite.NotNil(serverCertPEM, "Should decode server certificate PEM")

	parsedServerCert, err := x509.ParseCertificate(serverCertPEM.Bytes)
	suite.NoError(err, "Should parse server certificate")
	suite.False(parsedServerCert.IsCA, "Server certificate should not be CA")
	suite.Equal("openlit-webhook.openlit.svc", parsedServerCert.Subject.CommonName)

	// Verify SAN (Subject Alternative Names)
	expectedSANs := []string{
		"openlit-webhook.openlit.svc",
		"openlit-webhook.openlit.svc.cluster.local",
	}
	for _, expectedSAN := range expectedSANs {
		found := false
		for _, actualSAN := range parsedServerCert.DNSNames {
			if actualSAN == expectedSAN {
				found = true
				break
			}
		}
		suite.True(found, "Should contain expected SAN: %s", expectedSAN)
	}

	// Verify certificate chain
	roots := x509.NewCertPool()
	roots.AddCert(parsedCACert)
	
	opts := x509.VerifyOptions{Roots: roots}
	_, err = parsedServerCert.Verify(opts)
	suite.NoError(err, "Server certificate should be verifiable with CA")
}

func (suite *CertificateManagerTestSuite) TestEnsureCertificate() {
	// Test creating new certificate
	err := suite.certManager.EnsureCertificate(suite.ctx)
	suite.NoError(err, "Should create certificate successfully")

	// Verify secret was created
	secret := &corev1.Secret{}
	err = suite.certManager.client.Get(suite.ctx, suite.certManager.secretKey, secret)
	suite.NoError(err, "Should retrieve created secret")

	// Verify secret contents
	suite.Contains(secret.Data, "tls.crt", "Secret should contain certificate")
	suite.Contains(secret.Data, "tls.key", "Secret should contain private key")
	suite.Contains(secret.Data, "ca.crt", "Secret should contain CA certificate")

	// Verify managed-by label
	suite.Equal("openlit-operator", secret.Labels["app.kubernetes.io/managed-by"])

	// Test idempotency - calling again should not error
	err = suite.certManager.EnsureCertificate(suite.ctx)
	suite.NoError(err, "Should be idempotent")
}

func (suite *CertificateManagerTestSuite) TestShouldManageSecret() {
	tests := []struct {
		name        string
		secret      *corev1.Secret
		expected    bool
		description string
	}{
		{
			name: "Secret with managed-by label",
			secret: &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app.kubernetes.io/managed-by": "openlit-operator",
					},
				},
			},
			expected:    true,
			description: "Should manage secret with proper label",
		},
		{
			name: "Secret without managed-by label",
			secret: &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"other": "label",
					},
				},
			},
			expected:    false,
			description: "Should not manage secret without proper label",
		},
		{
			name: "Secret with different managed-by value",
			secret: &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app.kubernetes.io/managed-by": "other-operator",
					},
				},
			},
			expected:    false,
			description: "Should not manage secret managed by other operator",
		},
		{
			name: "Secret with no labels",
			secret: &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{},
			},
			expected:    false,
			description: "Should not manage secret with no labels",
		},
	}

	for _, tt := range tests {
		suite.Run(tt.name, func() {
			result := suite.certManager.shouldManageSecret(tt.secret)
			suite.Equal(tt.expected, result, tt.description)
		})
	}
}

func (suite *CertificateManagerTestSuite) TestNeedsCertificateRotation() {
	// Create a secret with recent certificate
	recentTime := time.Now().Add(-1 * time.Hour)
	caCert, _, _ := suite.certManager.generateCA()
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			CreationTimestamp: metav1.Time{Time: recentTime},
		},
		Data: map[string][]byte{
			"ca.crt": caCert,
		},
	}

	needs, reason := suite.certManager.needsCertificateRotation(secret)
	suite.False(needs, "Recent certificate should not need rotation")
	suite.Equal("certificate is still valid", reason)

	// Test old certificate
	oldTime := time.Now().Add(-25 * time.Hour) // Older than 24 hours
	secret.ObjectMeta.CreationTimestamp = metav1.Time{Time: oldTime}

	needs, reason = suite.certManager.needsCertificateRotation(secret)
	suite.True(needs, "Old certificate should need rotation")
	suite.Equal("certificate age exceeds rotation interval", reason)

	// Test missing CA certificate
	secret.Data = map[string][]byte{
		"tls.crt": []byte("cert"),
		"tls.key": []byte("key"),
	}

	needs, reason = suite.certManager.needsCertificateRotation(secret)
	suite.True(needs, "Missing CA should trigger rotation")
	suite.Equal("missing required certificate data", reason)

	// Test invalid certificate
	secret.Data["ca.crt"] = []byte("invalid certificate")
	needs, reason = suite.certManager.needsCertificateRotation(secret)
	suite.True(needs, "Invalid certificate should trigger rotation")
	suite.Equal("certificate parsing failed", reason)
}

func (suite *CertificateManagerTestSuite) TestRotateCertificate() {
	// First, ensure a certificate exists
	err := suite.certManager.EnsureCertificate(suite.ctx)
	suite.NoError(err)

	// Get the original secret
	originalSecret := &corev1.Secret{}
	err = suite.certManager.client.Get(suite.ctx, suite.certManager.secretKey, originalSecret)
	suite.NoError(err)

	// Store original certificate data
	originalCert := make([]byte, len(originalSecret.Data["ca.crt"]))
	copy(originalCert, originalSecret.Data["ca.crt"])

	// Rotate the certificate
	err = suite.certManager.rotateCertificate(suite.ctx)
	suite.NoError(err, "Should rotate certificate successfully")

	// Get the updated secret
	updatedSecret := &corev1.Secret{}
	err = suite.certManager.client.Get(suite.ctx, suite.certManager.secretKey, updatedSecret)
	suite.NoError(err)

	// Verify certificate was actually changed
	suite.NotEqual(originalCert, updatedSecret.Data["ca.crt"], "Certificate should be different after rotation")

	// Verify new certificate is valid
	caCertPEM, _ := pem.Decode(updatedSecret.Data["ca.crt"])
	suite.NotNil(caCertPEM, "New CA certificate should be valid PEM")

	parsedCACert, err := x509.ParseCertificate(caCertPEM.Bytes)
	suite.NoError(err, "New CA certificate should be parseable")
	suite.True(parsedCACert.IsCA, "New certificate should be CA")
}

func (suite *CertificateManagerTestSuite) TestCertificateRotationLoop() {
	// Set short rotation interval for testing
	suite.certManager.rotationInterval = 100 * time.Millisecond
	
	// Ensure certificate exists
	err := suite.certManager.EnsureCertificate(suite.ctx)
	suite.NoError(err)

	// Create a context with timeout for the rotation loop
	ctx, cancel := context.WithTimeout(suite.ctx, 500*time.Millisecond)
	defer cancel()

	// Start certificate rotation
	suite.certManager.StartCertificateRotation(ctx)

	// Wait a bit to allow rotation loop to run
	time.Sleep(200 * time.Millisecond)

	// Stop certificate rotation
	suite.certManager.StopCertificateRotation()

	// The test verifies that the rotation loop can start and stop without errors
	// In a real scenario, we would verify that certificates are actually rotated
}

func (suite *CertificateManagerTestSuite) TestMultiReplicaScenario() {
	// Simulate multiple replicas trying to manage the same secret
	
	// Create first certificate manager (replica 1)
	cm1 := NewCertificateManager(
		suite.certManager.client,
		suite.certManager.loggerProvider,
		"openlit-webhook",
		"openlit",
		"openlit-webhook-tls",
		"openlit-webhook.openlit.svc",
	)

	// Create second certificate manager (replica 2)
	cm2 := NewCertificateManager(
		suite.certManager.client,
		suite.certManager.loggerProvider,
		"openlit-webhook",
		"openlit",
		"openlit-webhook-tls",
		"openlit-webhook.openlit.svc",
	)

	// Both replicas try to ensure certificate
	err1 := cm1.EnsureCertificate(suite.ctx)
	err2 := cm2.EnsureCertificate(suite.ctx)

	// Both should succeed without conflict
	suite.NoError(err1, "First replica should succeed")
	suite.NoError(err2, "Second replica should succeed")

	// Verify only one secret exists
	secret := &corev1.Secret{}
	err := suite.certManager.client.Get(suite.ctx, suite.certManager.secretKey, secret)
	suite.NoError(err, "Should retrieve the secret")
	suite.Equal("openlit-operator", secret.Labels["app.kubernetes.io/managed-by"])
}

func (suite *CertificateManagerTestSuite) TestCertificateValidation() {
	// Generate valid certificates
	caCert, caKey, err := suite.certManager.generateCA()
	suite.NoError(err)

	serverCert, serverKey, err := suite.certManager.generateServerCert(caCert, caKey)
	suite.NoError(err)

	// Test valid certificates
	isValid := suite.certManager.validateCertificate(caCert)
	suite.True(isValid, "Valid CA certificate should pass validation")

	isValid = suite.certManager.validateCertificate(serverCert)
	suite.True(isValid, "Valid server certificate should pass validation")

	// Test invalid certificates
	isValid = suite.certManager.validateCertificate([]byte("invalid certificate"))
	suite.False(isValid, "Invalid certificate should fail validation")

	isValid = suite.certManager.validateCertificate([]byte(""))
	suite.False(isValid, "Empty certificate should fail validation")

	// Test malformed PEM
	malformedPEM := []byte(`-----BEGIN CERTIFICATE-----
invalid base64 data
-----END CERTIFICATE-----`)
	isValid = suite.certManager.validateCertificate(malformedPEM)
	suite.False(isValid, "Malformed PEM should fail validation")
}

func (suite *CertificateManagerTestSuite) TestSecretManagement() {
	// Test creating secret with proper labels and ownership
	caCert, caKey, err := suite.certManager.generateCA()
	suite.NoError(err)

	serverCert, serverKey, err := suite.certManager.generateServerCert(caCert, caKey)
	suite.NoError(err)

	err = suite.certManager.createOrUpdateSecret(suite.ctx, caCert, serverCert, serverKey)
	suite.NoError(err, "Should create secret successfully")

	// Verify secret
	secret := &corev1.Secret{}
	err = suite.certManager.client.Get(suite.ctx, suite.certManager.secretKey, secret)
	suite.NoError(err)

	// Verify secret type
	suite.Equal(corev1.SecretTypeTLS, secret.Type, "Secret should be TLS type")

	// Verify required data fields
	requiredFields := []string{"tls.crt", "tls.key", "ca.crt"}
	for _, field := range requiredFields {
		suite.Contains(secret.Data, field, "Secret should contain %s", field)
		suite.NotEmpty(secret.Data[field], "Field %s should not be empty", field)
	}

	// Verify labels
	expectedLabels := map[string]string{
		"app.kubernetes.io/name":       "openlit-webhook",
		"app.kubernetes.io/managed-by": "openlit-operator",
		"app.kubernetes.io/component":  "webhook",
	}
	for key, value := range expectedLabels {
		suite.Equal(value, secret.Labels[key], "Label %s should have correct value", key)
	}
}

func TestCertificateManagerSuite(t *testing.T) {
	suite.Run(t, new(CertificateManagerTestSuite))
}

// Additional unit tests for specific functions
func TestCertificateExpiry(t *testing.T) {
	// Create a certificate manager for testing
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	fakeClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	
	loggerProvider := &observability.LoggerProvider{
		OTLPEnabled:   false,
		OTLPEndpoint:  "",
		ErrorMessage:  "",
	}

	cm := NewCertificateManager(
		fakeClient,
		loggerProvider,
		"test-webhook",
		"test-ns",
		"test-secret",
		"test-service.test-ns.svc",
	)

	// Generate certificate
	caCert, _, err := cm.generateCA()
	assert.NoError(t, err)

	// Parse certificate to check expiry
	caCertPEM, _ := pem.Decode(caCert)
	parsedCert, err := x509.ParseCertificate(caCertPEM.Bytes)
	assert.NoError(t, err)

	// Verify certificate is valid for at least 364 days (allowing for slight timing differences)
	expectedExpiry := time.Now().Add(364 * 24 * time.Hour)
	assert.True(t, parsedCert.NotAfter.After(expectedExpiry), "Certificate should be valid for at least 1 year")
}

func TestSecretLabelsAndAnnotations(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	fakeClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	
	loggerProvider := &observability.LoggerProvider{
		OTLPEnabled:   false,
		OTLPEndpoint:  "",
		ErrorMessage:  "",
	}

	cm := NewCertificateManager(
		fakeClient,
		loggerProvider,
		"test-webhook",
		"test-ns",
		"test-secret",
		"test-service.test-ns.svc",
	)

	ctx := context.Background()
	err := cm.EnsureCertificate(ctx)
	assert.NoError(t, err)

	secret := &corev1.Secret{}
	err = fakeClient.Get(ctx, cm.secretKey, secret)
	assert.NoError(t, err)

	// Verify required labels
	assert.Equal(t, "test-webhook", secret.Labels["app.kubernetes.io/name"])
	assert.Equal(t, "openlit-operator", secret.Labels["app.kubernetes.io/managed-by"])
	assert.Equal(t, "webhook", secret.Labels["app.kubernetes.io/component"])
}
