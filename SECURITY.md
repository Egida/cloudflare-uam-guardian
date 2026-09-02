# Security Policy

## Supported Versions

Only the latest major release of this project actively receives security updates and vulnerability patches.

| Version | Supported          |
| :------ | :----------------- |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## Reporting a Vulnerability

We take the security of automated infrastructure defense tools seriously. If you discover a security vulnerability, flaw in the detection logic, or potential credential exposure issue, please report it responsibly.

### Disclosure Process

1. **Do not create public issues:** Please do not disclose vulnerabilities in public GitHub issues, pull requests, or public forums.
2. **Contact:** Submit a private vulnerability report via GitHub Security Advisories (if enabled on the repository) or email the repository maintainers directly.
3. **Information to Include:**
   - Detailed description of the vulnerability.
   - Steps to reproduce or proof-of-concept (PoC) code.
   - Potential impact (e.g., Denial of Service, credential leak, detection bypass).
   - Affected configuration parameters or environment variables.
4. **Response SLA:**
   - Initial acknowledgement: within **48 hours**.
   - Assessment and triage: within **5 business days**.
   - Remediation and advisory publication: scheduled collaboratively according to coordinated disclosure guidelines.

---

## Production Security Best Practices

When deploying this daemon in production environments, follow these operational security standards:

### 1. Cloudflare API Token Scoping (Least Privilege)
- **Never use Global API Keys.**
- Issue an API Token scoped strictly to the specific Zone ID requiring automation.
- Restrict permissions exclusively to:
  - `Zone > Zone Settings > Edit`
  - `Zone > Analytics > Read`
- Optional: Bind the API Token to your server's static egress IP address in the Cloudflare Dashboard under **Client IP Address Filtering**.

### 2. File System Permissions & Secrets Management
- Protect the `.env` file containing tokens from unauthorized local reading:
  ```bash
  chmod 600 .env
  chown uam-daemon:uam-daemon .env
  ```
- The daemon automatically sets `0600` permissions on the persistent state file (`uam-state.json`) upon creation. Ensure the enclosing directory is not world-readable.

### 3. Dedicated Service Account
- Run the daemon under an unprivileged system user (e.g., `uam-daemon`) rather than `root`.
- In `ecosystem.config.js` or systemd service definitions, restrict user execution context:
  ```bash
  # Create a dedicated unprivileged user
  sudo useradd --system --no-create-home --shell /bin/false uam-daemon
  ```

### 4. Network Egress & SSRF Protection
- The daemon initiates outbound HTTPS connections to:
  - `api.cloudflare.com:443` (Cloudflare API v4)
  - `discord.com:443` (Discord Webhook API, if enabled)
- If your server enforces outbound firewall rules (e.g., via `iptables` or `ufw`), restrict egress to port 443 only.
- Outbound Discord webhook URLs are strictly validated to prevent redirection to private IP ranges (SSRF defense).

### 5. Log Security & Redaction
- The built-in logger (`logger/index.ts`) recursively strips sensitive fields (`CF_API_TOKEN`, webhook URLs, authorization headers) from standard output.
- Avoid configuring log levels to `trace` in shared multi-tenant environments unless temporarily diagnosing low-level network issues.
