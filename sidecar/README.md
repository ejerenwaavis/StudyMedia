# StudyMedia Home Sidecar (Zero-Trust Private Tailscale Serve)

Hardened Node/Express extraction server (`yt-dlp` + `ffmpeg`) bound strictly to `127.0.0.1:4848` and exposed **exclusively** inside your private WireGuard Tailnet via **`tailscale serve`** (never `tailscale funnel`).

## Security Architecture
- **0% Public Internet Exposure:** `tailscale serve` is reachable **only** by devices authenticated to your private Tailscale Tailnet. Zero open router ports, zero public DNS exposure.
- **Loopback-Only Enforcement:** Express binds to `127.0.0.1:4848` and actively rejects any non-loopback TCP socket.
- **Defense-in-Depth Inside Tailnet:**
  - Constant-time `x-api-key` verification (`crypto.timingSafeEqual`) + 15-minute lockout after 10 failed attempts (`HTTP 429`).
  - Strict CORS + Chrome Private Network Access allowlist (`https://studymedia.aceddivision.com` and `http://localhost:5173` only).
  - `yt-dlp` executed with argument arrays, `--no-exec`, `--no-playlist`, `--`, `250M` max size, `180s` timeout, max 2 concurrent jobs, rate limiting, and immediate temp-file cleanup.

## PC Setup
1. Install dependencies and configure `sidecar/.env` (locked to your Windows user via NTFS permissions):
   ```powershell
   cd sidecar
   npm install
   ```
2. Sign into Tailscale on this PC and ensure **MagicDNS** and **HTTPS Certificates** are enabled in the [Tailscale Admin Console → DNS](https://login.tailscale.com/admin/dns).
3. Run the private Serve script (strictly NO Funnel):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup-tailscale-serve.ps1
   ```
   Copy the permanent `https://<pc-name>.<tailnet>.ts.net` URL printed by `tailscale serve status`.

## Phone Setup
1. Install the official **Tailscale** app from Google Play Store (Android) or App Store (iOS) and sign in with the **same** Tailscale account.
2. Keep Tailscale toggled **On** whenever you want to pull lectures from your Home Sidecar.
3. Open **StudyMedia → Settings → Home Sidecar & Download Pipeline**, enter your permanent `https://<pc-name>.<tailnet>.ts.net` URL and your `x-api-key`, tap **Test Connection**, and save.

## Maintenance
Keep `yt-dlp` up to date weekly:
```powershell
yt-dlp -U
```
