# Cloudflare UAM Guardian

A lightweight, zero-dependency background daemon that automates Cloudflare's Under Attack Mode (UAM) based on real-time traffic analysis and local system health.

By default, Cloudflare's UAM requires manual intervention. This tool acts as an automated shield, continuously monitoring your server's health and Cloudflare's analytics to instantly mitigate DDoS attacks without requiring manual toggling.

## Features

- **Volumetric Attack Detection:** Monitors HTTP Request Per Second (RPS) via Cloudflare's GraphQL Analytics API. Automatically enables UAM when a predefined threshold is breached.
- **Low-and-Slow Attack Mitigation:** Tracks HTTP 5xx error rates. If attackers bypass caching and overwhelm the backend (e.g., database exhaustion), UAM is triggered even if the overall RPS is low.
- **Local System Health Monitoring:** Independently tracks local CPU usage using a 10-second moving average. If the daemon detects sustained high CPU load (e.g., a Layer 7 attack bypassing Cloudflare limits), it triggers UAM instantly, bypassing the inherent 1-minute delay of Cloudflare's Analytics API.
- **Discord Integration:** Sends real-time alerts when an attack is detected, ongoing, or mitigated.
- **Minimal Footprint:** Runs entirely in the background (no open ports), consumes < 50MB RAM, and incurs near-zero CPU overhead.

## Prerequisites

- Node.js 20.x or higher
- PM2 (Process Manager)
- Cloudflare API Token (Requires `Analytics: Read` and `Zone Settings: Edit` permissions)
- A valid Cloudflare Zone ID

## Installation & Deployment (Production)

Follow these steps to deploy the daemon on your VPS.

1. **Clone the repository**
   Upload the project files to your server or clone them via git.

   ```bash
   cd /path/to/uam-automation
   ```

2. **Install dependencies**
   Do not upload the `node_modules` directory from your local machine. Install them directly on the server to ensure OS-specific bindings are correctly built.

   ```bash
   npm install
   ```

3. **Configure the environment**
   Create a `.env` file based on the provided example.

   ```bash
   cp .env.example .env
   nano .env
   ```
   Provide your Cloudflare credentials and adjust the thresholds according to your server's baseline performance.

4. **Build the project**
   Compile the TypeScript source code into JavaScript.

   ```bash
   npm run build
   ```

5. **Start the daemon**
   Use PM2 and the provided `ecosystem.config.js` to run the daemon in the background. The config limits memory usage to 150MB and ensures the process restarts automatically if it crashes.

   ```bash
   pm2 start ecosystem.config.js
   ```

6. **Enable startup on boot**
   Ensure PM2 restarts the daemon when the server reboots.

   ```bash
   pm2 save
   pm2 startup
   ```
   Follow the instructions printed in the terminal after running `pm2 startup` to finalize the setup.

## Configuration Reference

Key variables in the `.env` file:

- `ENABLE_THRESHOLD`: The RPS limit that triggers UAM (e.g., 1000).
- `DISABLE_THRESHOLD`: The safe RPS limit required to turn UAM off (e.g., 350).
- `ERROR_RATE_THRESHOLD`: The percentage of 5xx errors tolerated before UAM is triggered (e.g., 5).
- `COOLDOWN_MINUTES`: How long the traffic must remain below the disable threshold before UAM is turned off (e.g., 5).
- `CPU_THRESHOLD`: The maximum allowed average CPU usage percentage before UAM is triggered instantly (e.g., 90).
- `LOCAL_MONITORING_ENABLED`: Set to `true` if the daemon runs on the same server as your application.

## Process Management

Use standard PM2 commands to manage the daemon:
- `pm2 status`: View running processes.
- `pm2 logs uam-automation`: View real-time logs and attack detection events.
- `pm2 monit`: View CPU and RAM usage metrics.
- `pm2 restart uam-automation`: Restart the daemon (required after modifying `.env`).

## License
MIT
