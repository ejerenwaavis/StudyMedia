# StudyMedia Home Sidecar

Lightweight, private Node/Express extraction server (`yt-dlp` + `ffmpeg`) that runs on your home desktop, locks access behind an `x-api-key` secret + CORS allowlist, and streams MP4/MP3 lectures straight into StudyMedia's offline IndexedDB storage.

## Prerequisites
- **Node.js 18+**
- **`yt-dlp`** and **`ffmpeg`** installed and available on your system `PATH`
- **`cloudflared`** installed (for private remote phone access)

---

## 3-Step Quick Startup

### Step 1: Install Dependencies & Configure `.env`
```bash
cd sidecar
npm install
```
Copy `.env.example` to `.env` and set a strong random `API_KEY` (e.g., a 16-digit or 32-character secret):
```env
PORT=4848
API_KEY=replace_with_a_long_random_secret
ALLOWED_ORIGINS=https://studymedia.aceddivision.com,http://localhost:5173
HOST=127.0.0.1
```

### Step 2: Start the Sidecar Server
```bash
node server.js
```
You should see:
`StudyMedia sidecar listening on http://127.0.0.1:4848`

### Step 3: Expose Privately with a Quick Cloudflare Tunnel
In a second terminal:
```bash
cloudflared tunnel --url http://127.0.0.1:4848
```
Copy the generated `https://xxxx.trycloudflare.com` URL and your `API_KEY` into **StudyMedia → Settings → Home Sidecar & Download Pipeline**, then tap **Test Connection**.

---

## Setting Up a Permanent Cloudflare Named Tunnel (Recommended)

Quick `trycloudflare.com` URLs change every time you restart the tunnel. To map a permanent private subdomain (e.g. `https://sidecar.aceddivision.com`):

1. **Authenticate `cloudflared` with your Cloudflare account:**
   ```bash
   cloudflared tunnel login
   ```
2. **Create a named tunnel:**
   ```bash
   cloudflared tunnel create studymedia-sidecar
   ```
   Note the `<TUNNEL_ID>` and credentials JSON path printed in the output.
3. **Create the DNS CNAME route in Cloudflare:**
   ```bash
   cloudflared tunnel route dns studymedia-sidecar sidecar.aceddivision.com
   ```
4. **Create `~/.cloudflared/config.yml`:**
   ```yaml
   tunnel: <TUNNEL_ID>
   credentials-file: C:\Users\<YOUR_USER>\.cloudflared\<TUNNEL_ID>.json

   ingress:
     - hostname: sidecar.aceddivision.com
       service: http://127.0.0.1:4848
     - service: http_status:404
   ```
5. **Run the permanent tunnel:**
   ```bash
   cloudflared tunnel run studymedia-sidecar
   ```
6. Save `https://sidecar.aceddivision.com` + your `API_KEY` in **StudyMedia → Settings**.

---

## Maintenance Tip
Keep `yt-dlp` fresh weekly so YouTube changes don't break extractions:
```bash
yt-dlp -U
```
