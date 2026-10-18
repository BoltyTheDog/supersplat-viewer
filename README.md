# SuperSplat Viewer Gallery

A self-hosted, gallery-first fork of the [SuperSplat Viewer](https://github.com/playcanvas/supersplat-viewer). The start page lists your splats in SuperSplat's dark grey/orange visual style. Search by title, description, author or tags, open any splat in the full high-performance viewer with progressive chunk loading, and use **← Back to splats** to return. Each splat has a shareable `/?splat=folder-name` link.

---

## Run on your home server

Requires Node.js 20.19+:

```sh
npm ci
npm run build
cp .env.example .env
chmod 600 .env
npm run auth:password
# Edit .env: set AUTH_USERNAME and paste the generated AUTH_PASSWORD_HASH line.
npm start
```

Access the app through your HTTPS domain. For local HTTP testing only, set `AUTH_COOKIE_SECURE=false` in `.env` and open `http://localhost:3000`. The server listens on all interfaces by default. Configure `PORT`, `HOST`, and `SPLATS_DIR` as needed, for example:

```sh
SPLATS_DIR=/srv/splats PORT=3000 npm start
```

Alternatively, with Docker Compose:

```sh
mkdir -p splats
docker compose up -d --build
```

Compose reads the same `.env` file; configure credentials before starting it. The password hash is passed at runtime, not baked into the image.

**Use HTTPS when accessing from other devices.** The viewer uses WebGPU when available (falling back to WebGL2), which requires a secure context (HTTPS, or localhost for development). Put the app behind a reverse proxy such as Caddy with a trusted TLS certificate. Proxy the entire domain to Node, including `/login`, `/logout`, `/api/*`, and `/splats/*`. Do not serve `public`, `dist`, or `splats` directly with Caddy: that would bypass the login checks. Bind Node to `127.0.0.1` when Caddy runs on the same machine, and keep its port off the public internet.

---

## Login and security

The gallery uses one shared account configured on the server. There is no public registration or account database. The login page matches the grey/orange SuperSplat UI. Both the gallery and viewer have a **Sign out** button, and splat links return to their original scene after sign-in.

`.env` is loaded automatically by `npm start`; explicit process/systemd environment variables take precedence. It is git-ignored and excluded from Docker images. Never commit passwords or hashes. Use `npm run auth:password` in an interactive terminal to create a salted scrypt hash without displaying your password or putting it in shell history. Passwords must be at least 12 characters.

```ini
AUTH_USERNAME=bolty
AUTH_PASSWORD_HASH=scrypt:YOUR_GENERATED_SALT:YOUR_GENERATED_HASH
AUTH_COOKIE_SECURE=true
```

Keep secure cookies enabled behind Caddy/HTTPS. Only local HTTP development should use `AUTH_COOKIE_SECURE=false`. Missing or malformed credentials stop the server. To deliberately operate a public gallery without login, explicitly set `AUTH_DISABLED=true` (not recommended for private scans).

### Systemd deployment

On your server:

```sh
cd ~/Software/supersplat-viewer
git pull --ff-only
npm ci
npm run build
cp .env.example .env  # first setup only; do not overwrite an existing secrets file
chmod 600 .env
npm run auth:password
nano .env
# Set your username and replace the placeholder hash with the generated line.
sudo systemctl restart supersplat-viewer
```

Caddy configuration:

```caddy
splats.bolty.website {
    reverse_proxy 127.0.0.1:3000
}
```

### Protections and limits

- Protected server-side: pages, application JavaScript, API, splat files, thumbnails, and metadata, including HEAD and byte-range requests. Only login CSS and its favicon are public.
- Sessions use random tokens stored hashed in memory, expire after 12 hours, and are revoked on sign-out. Restarting the server signs everyone out. Cookies are host-only, HttpOnly, SameSite=Strict, and Secure by default.
- Sign-in is limited to 10 attempts per 15 minutes per direct network peer, with bounded concurrent password checks. Behind Caddy, visitors share its peer limit; forwarded IP headers are intentionally not trusted.
- Same-origin POST checks guard sign-in/sign-out; framing is denied. Private responses use `Cache-Control: private, no-store`.

---

## Add splats

Upload one folder per scene (no rebuild or restart needed), then click **Refresh**:

```text
splats/
  garden/
    scene.ply          # .ply, .compressed.ply, .sog, or lod-meta.json
    metadata.json      # optional
    preview.jpg        # optional
```

Example `metadata.json`:

```json
{
  "title": "The garden",
  "description": "An afternoon scan of the garden.",
  "author": "Bolty",
  "date": "2026-10-18",
  "tags": ["outdoors", "360-camera", "photogrammetry"],
  "file": "scene.ply",
  "thumbnail": "preview.jpg"
}
```

All fields are optional. Without metadata, the folder name is used as the title. `file` defaults to the preferred splat file found in the folder (`.sog`, `lod-meta.json`, `.compressed.ply`, or `.ply`). `file` and `thumbnail` must be plain filenames within that folder; thumbnails support JPEG, PNG and WebP. Splat files stream with HTTP byte-range support for fast progressive loading.

Checks: `npm test`, `npx tsc --noEmit`, `npm run build`.

---

## Upstream SuperSplat Viewer

[![NPM Version](https://img.shields.io/npm/v/@playcanvas/supersplat-viewer)](https://www.npmjs.com/package/@playcanvas/supersplat-viewer)
[![License](https://img.shields.io/npm/l/@playcanvas/supersplat-viewer)](https://github.com/playcanvas/supersplat-viewer/blob/main/LICENSE)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white&color=black)](https://discord.gg/RSaMRzg)
[![Reddit](https://img.shields.io/badge/Reddit-FF4500?style=flat&logo=reddit&logoColor=white&color=black)](https://www.reddit.com/r/PlayCanvas)
[![X](https://img.shields.io/badge/X-000000?style=flat&logo=x&logoColor=white&color=black)](https://x.com/intent/follow?screen_name=playcanvas)

| [User Manual](https://developer.playcanvas.com/user-manual/gaussian-splatting/editing/supersplat/import-export/#html-viewer-htmlzip) | [Blog](https://blog.playcanvas.com) | [Forum](https://forum.playcanvas.com) |

This is the official viewer for [SuperSplat](https://superspl.at).

<img width="1114" height="739" alt="supersplat-viewer" src="https://github.com/user-attachments/assets/15d2c654-9484-4265-a279-99acb65e38c9" />

The web app compiles to a simple, self-contained static website.
