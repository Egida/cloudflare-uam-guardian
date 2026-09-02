# Cloudflare UAM Guardian Daemon

A background daemon that automates Cloudflare's **Under Attack Mode (UAM)** toggle based on real-time edge traffic metrics, origin HTTP error rates, and local server hardware load.

Cloudflare Under Attack Mode enforces a JavaScript/CAPTCHA challenge to incoming visitors. Enabling and disabling it manually through the Cloudflare dashboard creates operational delay during sudden Layer 7 DDoS attacks and often leaves the challenge active longer than necessary after traffic normalizes. This daemon automates the entire lifecycle: detecting incoming volumetric or origin-exhaustion attacks, enabling UAM via Cloudflare API v4, holding a configurable cooldown period to prevent flapping, and safely reverting to your baseline security level once traffic returns to normal.

---

## Key Architecture & Design Principles

```
  +----------------------------------------------------------------+
  |                   Every CHECK_INTERVAL seconds                 |
  +----------------------------------------------------------------+
          |                                       |
  [Cloudflare GraphQL API]               [Local System Monitor]
   - Total requests (RPS)                 - Multi-core CPU delta
   - HTTP 5xx error rate                  - Process & system RAM
          |                                       |
          +-------------------+-------------------+
                              |
                     [Detection Engine]
          - Evaluates RPS against thresholds
          - Evaluates HTTP 5xx error percentage
          - Evaluates Origin CPU saturation
          - Computes non-diluted threat score (0-100)
                              |
                    [State & Decision Engine]
          +-------------------+-------------------+
          |                                       |
     Score >= 70                             Score < 70
     (Attack Confirmed)                      (Normal / Warning)
          |                                       |
     UAM Currently OFF?                      UAM Currently ON?
       YES: Enable UAM via API                 YES: Cooldown expired?
            Start cooldown timer                    YES: Revert to default security level
            Notify Discord webhook                  NO:  Hold UAM (extend cooldown)
       NO:  Extend cooldown timer              NO:  Maintain normal state
```

### 1. Multi-Vector Attack Evaluation
The daemon does not rely on a single data point. Traffic is evaluated across three vectors:
- **Volumetric HTTP Floods (RPS):** Queries Cloudflare's GraphQL Analytics API (`httpRequestsAdaptiveGroups`) over a rolling 3-minute window. Triggers when requests per second exceed `ENABLE_THRESHOLD`.
- **Origin Saturation / Low-and-Slow (HTTP 5xx):** Attacks targeting expensive endpoints (e.g., search queries, database-heavy scripts) can exhaust origin resources at low request volumes. If edge responses in the 500–599 range exceed `ERROR_RATE_THRESHOLD`, the daemon intervenes even if total RPS remains low.
- **Direct-to-Origin Bypass (CPU Load):** Edge metrics typically have a 1–2 minute reporting latency. The local system monitor calculates CPU time deltas (`os.cpus()`) every 2 seconds. If origin CPU load crosses `CPU_THRESHOLD`, UAM is activated immediately to mitigate attacks bypassing CDN caching or origin firewall rules.

### 2. Anti-Dilution Scoring Logic
Traditional multi-rule detectors often average their scores. In a security context, averaging is dangerous: a 99% CPU spike averaged against 0% error rate would yield an artificially low score (~33%), ignoring an active attack. This daemon uses an **anti-dilution engine**: the composite score is bounded from below by the maximum score of any single rule, guaranteeing that a critical breach on any vector triggers defensive action immediately.

### 3. Fail-Safe Outage Handling
If network disruption or upstream Cloudflare issues prevent metric collection, `getTrafficMetrics()` returns `null` rather than zeros. The daemon treats `null` as "metrics unavailable" and **preserves the existing state**. It will never interpret an API failure as "zero traffic" and disable protection during an active DDoS attack. If failures persist beyond `MAX_CONSECUTIVE_API_FAILURES`, an alert is dispatched.

### 4. Anti-Flapping Hysteresis & External Sync
- **Hysteresis:** UAM requires separate activation (`ENABLE_THRESHOLD`) and deactivation (`DISABLE_THRESHOLD`) boundaries, followed by a mandatory `COOLDOWN_MINUTES` waiting period with normal traffic before deactivation occurs.
- **External State Reconciliation:** If an operator toggles UAM directly via the Cloudflare dashboard, the daemon detects the divergence during its periodic sync, aligns its local state file, and logs an audit record without overwriting manual administrator actions.

### 5. Security & Isolation
- **Log Sanitization:** Sensitive values (`CF_API_TOKEN`, webhook tokens, authorization headers) are automatically masked at startup and scrubbed from all structured logs via recursive redaction with depth limits and circular-reference protection.
- **State File Permissions:** Local state files (`uam-state.json`) are written atomically with POSIX `0600` permissions (owner read/write only).
- **Webhook Restrictions:** Outbound alert destinations are strictly validated to prevent arbitrary external SSRF endpoints.

---

## Prerequisites

- **Node.js:** v20.x LTS or higher
- **Process Manager:** PM2 (recommended for production daemonization)
- **Cloudflare API Token:** Configured with the following permissions:
  - `Zone` > `Zone Settings` > `Edit`
  - `Zone` > `Analytics` > `Read`
- **Zone ID:** Found on your domain's **Overview** page in the Cloudflare dashboard.

---

## Installation & Production Deployment

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-org/uam-automation.git /opt/uam-automation
cd /opt/uam-automation

# Install dependencies
npm install --production=false
```

### 2. Configure Environment
Copy the sample environment file and configure your credentials:
```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Ensure `CF_API_TOKEN` and `CF_ZONE_ID` are populated, and adjust traffic thresholds to match your server's baseline.

### 3. Build & Verify
Compile TypeScript source to JavaScript and run the test suite:
```bash
# Compile TypeScript to dist/
npm run build

# Run unit tests
npm test
```

### 4. Start via PM2
The repository includes an `ecosystem.config.js` with memory boundaries (150MB restart ceiling), log timestamps, and single-instance constraints:
```bash
# Start daemon with PM2
pm2 start ecosystem.config.js

# Verify daemon status
pm2 status uam-automation

# Persist across system reboots
pm2 save
pm2 startup
```

---

## Configuration Reference

All settings are configured via environment variables in `.env`:

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `CF_API_TOKEN` | String | *Required* | Cloudflare API Token with `Zone Settings: Edit` and `Analytics: Read`. |
| `CF_ZONE_ID` | String | *Required* | 32-character hexadecimal Zone ID for your target domain. |
| `CHECK_INTERVAL` | Integer | `10` | Frequency (in seconds) between traffic checks. Recommended: `5`–`15`. |
| `ENABLE_THRESHOLD` | Integer | `1200` | Requests Per Second (RPS) required to trigger Under Attack Mode. |
| `DISABLE_THRESHOLD` | Integer | `350` | Maximum RPS permitted before the system will consider deactivating UAM. Must be lower than `ENABLE_THRESHOLD`. |
| `ERROR_RATE_THRESHOLD` | Number (1–100) | `5` | HTTP 5xx error percentage at the edge required to trigger attack state. |
| `COOLDOWN_MINUTES` | Integer | `5` | Duration (in minutes) traffic must remain below `DISABLE_THRESHOLD` before reverting security level. |
| `DEFAULT_SECURITY_LEVEL` | String | `medium` | Security level restored when UAM is disabled: `off`, `essentially_off`, `low`, `medium`, `high`. |
| `LOCAL_MONITORING_ENABLED` | Boolean | `true` | Enables local multi-core CPU monitoring (`true`/`false`). |
| `CPU_THRESHOLD` | Number (1–100) | `90` | Origin average CPU utilization percentage that immediately triggers UAM. |
| `DISCORD_WEBHOOK_URL` | String | *Optional* | Discord webhook URL for notifications. Must point to a valid `discord.com` domain. |
| `LOG_LEVEL` | String | `info` | Logging verbosity: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |
| `STATE_FILE_PATH` | String | `./uam-state.json` | Path to persistent state file tracking attack status and timestamps. |
| `HEARTBEAT_INTERVAL_MINUTES`| Integer | `360` | Interval (in minutes) for periodic status notifications to Discord. |
| `MAX_CONSECUTIVE_API_FAILURES` | Integer | `5` | Cloudflare API failure count before a `CRITICAL` Discord alert is sent. |

### Selecting Thresholds
- **Baseline RPS:** Review your Cloudflare Analytics dashboard during peak business hours. Set `ENABLE_THRESHOLD` at approximately 2.5x to 3x your normal peak RPS.
- **Disable Threshold:** Set `DISABLE_THRESHOLD` at 1.2x to 1.5x your baseline peak. Keeping a substantial gap between enable and disable thresholds prevents cycling (rapid toggling).
- **Cooldown Window:** Keep `COOLDOWN_MINUTES` at 5 minutes or higher. Many distributed attack scripts pause briefly before resuming with higher volume.

---

## Operations & Monitoring

### Process Management
```bash
# Check process health and uptime
pm2 show uam-automation

# Tail live application logs
pm2 logs uam-automation --lines 50

# Restart daemon after updating .env
pm2 restart uam-automation --update-env

# Stop daemon
pm2 stop uam-automation
```

### Log Structure & Audit Trail
Logs are structured as JSON via Pino. In production, logs output standard ISO timestamps and contextual metadata:
```json
{
  "level": 30,
  "time": "2026-09-02T03:45:00.123Z",
  "name": "uam-guardian",
  "tickId": "tick-142",
  "rps": 1450,
  "errorRate": "0.12%",
  "cpuUsage": "34.2%",
  "status": "ATTACK",
  "score": 100,
  "isUnderAttack": false,
  "msg": "Evaluated traffic state"
}
```

State transitions produce an audit log detailing the previous and updated state:
```json
{
  "level": 30,
  "time": "2026-09-02T03:45:00.450Z",
  "name": "uam-guardian",
  "transition": "ENABLED_UAM",
  "before": { "isUnderAttack": false, "enabledAt": null },
  "after": { "isUnderAttack": true, "enabledAt": 1788320700450, "lastDecision": "ENABLED_UAM" },
  "msg": "State transition recorded"
}
```

### Recommended: Log Rotation Setup
To prevent unmanaged log growth on production servers, configure PM2 log rotation:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

---

## Troubleshooting

### 1. `Cloudflare API authentication failed (401/403)`
- **Cause:** Invalid API token or insufficient permissions.
- **Resolution:** Verify that the API token was created under the correct Cloudflare account and that permissions include `Zone Settings: Edit` and `Analytics: Read` scoped to the relevant Zone ID. Run `curl -X GET "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID" -H "Authorization: Bearer $CF_API_TOKEN"` to test manually.

### 2. `Cloudflare GraphQL response contained no zone data`
- **Cause:** `CF_ZONE_ID` does not match the zone associated with the token, or the domain has not had HTTP proxying (orange cloud) enabled long enough to register analytics data.
- **Resolution:** Double check the 32-character Zone ID on the domain overview page.

### 3. `Rate limited by Cloudflare API (429)`
- **Cause:** Too many API requests per minute.
- **Resolution:** The daemon implements automatic exponential backoff compliant with RFC-7231 (`Retry-After` header parsing). If you encounter frequent 429s, increase `CHECK_INTERVAL` in `.env` (e.g., from `5` to `15` seconds).

### 4. `DISCORD_WEBHOOK_URL must point to discord.com webhook endpoint`
- **Cause:** Invalid webhook URL supplied.
- **Resolution:** Ensure the URL begins with `https://discord.com/api/webhooks/` or `https://ptb.discord.com/api/webhooks/`. Arbitrary domains are blocked for SSRF defense.

### 5. `Cloudflare is in Under Attack Mode, but local state was false`
- **Behavior:** This is expected recovery behavior. On startup or during checks, the daemon queries Cloudflare directly. If UAM is already active (e.g., toggled manually or by a previous process), the daemon aligns its local state without disabling protection.

---

## Testing

A dedicated test suite validates the detection logic and anti-dilution calculations:
```bash
npm test
```
The test suite covers:
1. Normal baseline traffic validation.
2. Warning-level RPS evaluation.
3. Volumetric attack threshold breach.
4. Origin 5xx error rate escalation.
5. Hardware CPU saturation detection.
6. Multi-factor non-diluted score verification.

---

## License

This project is licensed under the [MIT License](LICENSE).

