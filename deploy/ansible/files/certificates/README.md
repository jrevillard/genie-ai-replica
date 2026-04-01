# SSL Certificates

Place `server.crt` and `server.key` in the environment-specific directory:

```
files/certificates/
├── README.md
├── test/
│   ├── server.crt
│   └── server.key
└── production/
    ├── server.crt
    └── server.key
```

These will be copied to the target node during deployment at
`{{ deploy_dir }}/secrets/ssl/` with `mode: 0600`.

**Do NOT commit real certificates.** Files matching `*.crt` and `*.key`
are excluded via `.gitignore`.

### Self-signed certificate (for testing):

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout server.key -out server.crt \
  -subj "/CN=your-domain-or-ip"
```
