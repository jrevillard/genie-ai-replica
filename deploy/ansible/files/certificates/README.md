# SSL Certificates

For `cert_mode: provided`, place `server.crt` and `server.key` in the
environment-group directory. The directory name is the inventory group matching
`^agrivisory` (resolved by `tasks/preflight-cert.yml` — NOT `group_names[0]`,
which is arbitrary when a host lives in several groups):

```
files/certificates/
├── README.md
└── agrivisory_rtx6000/
    ├── server.crt
    └── server.key
```

These are copied to the target node during deployment at
`{{ deploy_dir }}/secrets/ssl/` with `mode: 0600`.

Other `cert_mode` values need no files here:
- `letsencrypt` — certbot issues/renews; a named bootstrap self-signed cert is
  generated on the target until certbot's first issuance
- `selfsigned` — dev-only; generated on the target with CN/SAN =
  `nginx_public_domain` (which must be `localhost`)

**Do NOT commit real certificates.** Files matching `*.crt` and `*.key`
are excluded via `.gitignore`.

### Self-signed certificate (for testing):

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout server.key -out server.crt \
  -subj "/CN=your-domain-or-ip" \
  -addext "subjectAltName=DNS:your-domain-or-ip"
```
