# Security policy

Kitcount protects data about people who use drugs. We treat security reports
as a priority.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through
[GitHub security advisories](https://github.com/lobojoel2003/Kitcount/security/advisories/new).

Include the affected component (app, server, templates), the version (Settings
→ About, or `kitcount-server version`), steps to reproduce and the impact.
**Never include real participant data, device tokens or enrollment codes.**

We aim to acknowledge reports within 3 working days. After that we agree a
disclosure timeline with you, normally within 90 days. We credit reporters who
wish to be named.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x (latest minor) | ✅ |
| Older | ❌ — please upgrade |

## Scope

In scope: the mobile app, the sync server, the sync protocol and envelope
cryptography, report export, and the release pipeline (for example tampering
with published artifacts).

Out of scope: weaknesses that require an already compromised (rooted or
jailbroken) device while the app is unlocked, and denial of service against a
self-hosted server by someone who holds a valid device token. See
[docs/privacy-and-security.md](docs/privacy-and-security.md) for the full threat
model.

## Verifying releases

Every release asset has a SHA-256 checksum in `SHA256SUMS` and a build
provenance attestation:

```bash
gh attestation verify kitcount-server_1.0.0_linux_amd64.tar.gz --repo lobojoel2003/Kitcount
gh attestation verify oci://ghcr.io/lobojoel2003/kitcount-server:1.0.0 --repo lobojoel2003/Kitcount
```
