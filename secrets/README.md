# SSL Certificates

This directory contains SSL/TLS certificates for secure HTTPS connections.

## Quick Start

### Development (Auto-Generated)
No action needed — certificates are auto-generated on first start.

### Production
```bash
# 1. Place your certificates
cp /path/to/your/certificate.crt ./secrets/ssl/server.crt
cp /path/to/your/private-key.key ./secrets/ssl/server.key

# 2. Deploy (Swarm)
set -a && source .env && set +a && docker stack deploy -c docker-compose.yaml genieai
```

## File Formats

**Required filenames** (the entrypoint script expects these exact names):
- `server.crt` - SSL certificate (also supports `.pem` extension)
- `server.key` - Private key (also supports `.pem` extension)

**Supported formats:** PEM format (standard for SSL certificates)

## Development vs Production

### Development (Self-Signed)
Auto-generated self-signed certificates will cause browser warnings. This is expected in development.

### Production
Use proper certificates from:
- **Let's Encrypt** (certbot)
- **Organization PKI** (your certificate authority)
- **Cloud providers:** AWS ACM, GCP Cert Manager, Azure Key Vault

## Security

- **NEVER commit** actual certificates to git
- `.gitignore` is configured to protect `*.crt`, `*.key`, `*.pem` files

## Cloud-Native Deployment

These files are mounted as Docker secrets in `docker-compose.yaml`, ensuring consistent behavior across all environments (Compose, Swarm, Kubernetes).
