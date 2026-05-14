# AMINA — Physical Safeguards Policy

**Audience:** pilot operator, on-call engineer, auditor.
**Regulatory anchor:** HIPAA Security Rule §164.310 + Gambia Data Protection and Privacy Act 2025.
**Status:** v1. Pilot operator must fill operator-specific sections before launch.

---

## 1. Facility Access Controls (164.310(a)(1))

### 1.1 Server location

The AMINA production instance runs on a single A40 VM at 164.52.196.198 (Delhi region), hosted by a cloud provider. Physical access to the host machine is governed by the provider's data-center security policy (SOC 2 Type II certified).

The pilot operator must:
- Verify the hosting provider's physical security certification annually.
- Document the provider name and certification reference here: `__HOSTING_PROVIDER__` / `__CERT_REF__`.

### 1.2 Visitor access

No visitors require access to the AMINA production VM. All administrative work is performed remotely via SSH (key-authenticated, rate-limited).

If physical access to the host is ever required:
- The pilot operator must authorize and document the visit in the operations log.
- A chaperone must be present during any physical access.
- The visit must be logged with: date, visitor name, purpose, duration, chaperone name.

### 1.3 Access logs

SSH access is logged via `/var/log/auth.log` on the host. Failed SSH attempts trigger `fail2ban` after 5 retries.

## 2. Workstation Use (164.310(b))

### 2.1 Operator workstations

Any workstation used to access the AMINA production environment must:
- Run a supported operating system with current security patches.
- Use full-disk encryption (BitLocker, FileVault, or LUKS).
- Have automatic screen lock after ≤ 5 minutes of inactivity.
- Run up-to-date anti-malware software.
- Use a VPN or encrypted tunnel (Cloudflare tunnel in AMINA's case) for all access.

### 2.2 Screen privacy

When accessing AMINA admin/observatory dashboards:
- Position screens so they are not visible to unauthorized persons.
- Use privacy screen filters in shared or public spaces.
- Never leave AMINA admin sessions unattended.

## 3. Workstation Security (164.310(c))

### 3.1 Device requirements

| Requirement | Standard |
|---|---|
| Disk encryption | Full-disk, AES-256 equivalent |
| OS patching | Critical patches within 14 days |
| Anti-malware | Real-time protection enabled |
| Browser | Current stable version with auto-update |
| SSH keys | Ed25519, passphrase-protected, never shared |

### 3.2 Prohibited actions

- Never store PHI on local workstations (patient data stays in ArcadeDB/Redis).
- Never download database backups to personal devices.
- Never share SSH credentials or API tokens.
- Never take screenshots of admin dashboards containing patient data.

## 4. Device and Media Controls (164.310(d)(1))

### 4.1 Disposal

When any storage device that has held AMINA PHI is decommissioned:
- **Magnetic media**: DoD 5220.22-M standard wipe (3-pass) or physical destruction.
- **SSD media**: ATA Secure Erase (manufacturer-specific) or physical destruction.
- **Cloud volumes**: Delete the volume via the provider's API and verify deletion.
- Document the disposal in the operations log: device ID, method, date, operator.

### 4.2 Media re-use

Before re-using any media that previously held PHI:
- Perform a full secure wipe per §4.1.
- Verify the wipe by attempting to read the media (should return all zeros / unreadable).

### 4.3 Backup media

- Backup archives are encrypted with AES-256 (GPG symmetric) per the backup script.
- The backup passphrase is stored at `/root/amina/.backup-passphrase` (chmod 600, gitignored).
- Off-site backup copies must be stored in a physically secure location accessible only to the pilot operator.
- Backup media rotation is documented in [RETENTION_POLICY.md](RETENTION_POLICY.md).

### 4.4 Accountability

- The pilot operator is responsible for tracking all media containing AMINA PHI.
- A media inventory must be maintained (location, content description, date, custodian).
- Any transfer of media must be logged (sender, recipient, date, method).

## 5. Operator signoff

The pilot operator must review and sign this policy before launch:

```
I have read and understood the physical safeguards described in this document.
I confirm that the hosting provider meets the requirements in §1.1.
I will ensure all workstations accessing AMINA meet the requirements in §2-3.

Pilot operator: ________________________
Date: ___________
Signature: ____________________________
```

## 6. Review cadence

- Annually, or after any physical security incident.
- After any change in hosting provider or data-center location.

## 7. Linked controls

- Cross-cuts SEC-001 .. SEC-009 in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md).
