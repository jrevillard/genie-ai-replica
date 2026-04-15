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

### Production (Manual)
Use proper certificates from:
- **Organization PKI** (your certificate authority)
- **Cloud providers:** AWS ACM, GCP Cert Manager, Azure Key Vault

### Production (Let's Encrypt — Automatic)
Let's Encrypt certificates are automatically obtained and renewed via the `certbot` service.

**Activation:**
1. Set `CERTBOT_EMAIL` in `.env`:
   ```bash
   CERTBOT_EMAIL=your-email@example.com
   ```
2. Deploy with the appropriate flag:
   - **Docker Compose:** `docker compose --profile letsencrypt up -d`
   - **Docker Swarm:** Set `CERTBOT_REPLICAS=1` in `.env`, then deploy normally
3. Ensure `NGINX_PUBLIC_DOMAIN` is set to your public FQDN (not `localhost`)

**How it works:**
- On first start, certbot obtains a certificate via HTTP-01 challenge
- Certificates are written to `./secrets/ssl/server.crt` and `server.key`
- Renewal runs automatically every 12 hours inside the certbot container
- Nginx is automatically reloaded after renewal (no downtime)
- The `certbot-etc` named volume persists Let's Encrypt account state across restarts

**Testing (staging server):**
```bash
CERTBOT_STAGING=true
```
This uses Let's Encrypt's staging server to avoid rate limits during testing.

**Prerequisites:**
- Port 80 must be accessible from the internet
- Valid DNS A/AAAA record pointing `NGINX_PUBLIC_DOMAIN` to your server

## Security

- **NEVER commit** actual certificates to git
- `.gitignore` is configured to protect `*.crt`, `*.key`, `*.pem` files

## Cloud-Native Deployment

These files are mounted as volumes in `docker-compose.yaml`. The nginx entrypoint loads them from `/etc/nginx/ssl/` at startup. If no certificates are found, self-signed certificates are auto-generated for development.
