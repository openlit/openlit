# First create a certificate authority (CA) that will sign all serve and client certificates.
# The server and the client trust this CA. Typically the public key of the CA certificate
# will be hard-coded in the server and client implementations (and never changes or changes
# only in the catastrophic even of CA private key leak or when predefined CA rotation time
# comes - typically annual or rarer).

./clear.sh

# Create CA private key
openssl genrsa -out private/ca.key.pem 4096
chmod 600 private/ca.key.pem

# Create CA certificate
openssl req -new -x509 -days 3650 -key private/ca.key.pem -out cert/ca.cert.pem -config openssl.conf
chmod 644 cert/ca.cert.pem

#
# Create a private key for client certificate.
openssl genrsa -out client/client.key.pem 4096
chmod 600 client/client.key.pem
#
# Generate a client CRS
openssl req -new -key client/client.key.pem -out client/client.csr -config client.conf
chmod 600 client/client.csr
#
# Create a client certificate
openssl ca -config openssl.conf -days 1650 -notext -batch -in client/client.csr -out client/client.cert.pem
chmod 644 client/client.cert.pem
# The generated pair of files in client can be now used by TLS connection.

# Create private key for server certificate
openssl genrsa -out server/server.key.pem 4096
chmod 600 server/server.key.pem

# Generate server CRS
openssl req -new -key server/server.key.pem -out server/server.csr -config server.conf
chmod 600 server/server.csr

# Create Server certificate
openssl ca -config openssl.conf -extfile server_ext.conf -days 1650 -notext -batch -in server/server.csr -out server/server.cert.pem
chmod 644 server/server.cert.pem
# The generated pair of files in server can be now used by TLS connection.
