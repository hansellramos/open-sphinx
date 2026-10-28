# Sphinx (open-sphinx)

[Español](README.es.md)

**Self-hosted, end-to-end encrypted photo, video and file vault.** Built to run on a small home NAS. You unlock it with a passkey; the server stores only ciphertext and never sees your files, file names, tags, albums, dates or locations.

> The UI is in Spanish (the app is called *Esfinge*). Internal names use `boveda`.

## Features

- **Passkey unlock** (WebAuthn + PRF extension). The PRF secret never leaves the browser. Several passkeys plus a one-time 52-character recovery code.
- **End-to-end encryption** for everything: originals, thumbnails, video segments and metadata (title, tags, albums, notes, EXIF date, GPS, device).
- **Photos** (JPEG, HEIC, PNG…) with EXIF date, location and device, decrypted and shown in the browser.
- **Videos** streamed with HLS: segments are decrypted on the fly by a custom hls.js loader. No transcoding on upload (`ffmpeg -c copy`).
- **Files** of any kind, with in-browser preview (PDF, text, audio, images) and download of the original.
- **Gallery** grouped by day, month or year (pinch / Ctrl+wheel zoom), date scrubber, favorites, tags, albums, map, search and filters, *Recently added*.
- **Resumable uploads** (tus) with duplicate detection by encrypted hash.
- **Optional exports**: downscale to 720p or recompress heavy videos, with an explanation of *why* a video is heavy (bitrate vs. resolution and fps).
- **Trash** with 5-day retention for deleted items and replaced originals.
- **Horus mode**: show only selected tags/albums on every device until you exit with a passkey. It is enforced by the server, not just hidden in the UI. Useful to show work photos without exposing the rest.
- ZIP export, share sheet, rotation, notes, date/location bulk edit.

## Security model

- The vault has an **X25519 key pair**. The server holds only the **public key** (to seal new items) and the private key **wrapped** (AES-GCM) with secrets only you have: each passkey's PRF output and the recovery code.
- Each item has its own **AES-256-GCM** key, sealed with the vault public key (ephemeral ECDH + HKDF). Only the private key, which exists unwrapped only in browser memory, can open it.
- Originals are encrypted in 8 MiB chunks bound to their position. Type, name and MIME live in encrypted metadata, so the server can't tell a photo from a PDF.
- **What the server does see:** the upload in plaintext *while it is being processed* (kept in a RAM-only tmpfs, then encrypted and deleted), item sizes, upload times, and which items belong together in Horus mode (not why).
- Designed to be reached only over a private network (e.g. Tailscale with HTTPS). The API binds to `127.0.0.1` in the provided compose file.

## Requirements

- A browser and authenticator with **WebAuthn PRF** support: recent Chrome/Edge, Safari 18+ / iOS 18+, iCloud Keychain or Google Password Manager passkeys.
- Server: Docker (ARM64 or x86-64), `ffmpeg` (included in the image), ~1 GB RAM.
- HTTPS origin (passkeys are bound to the domain). `localhost` works for development.

## Quick start (development)

```sh
cp .env.example .env          # set SESSION_SECRET, RP_ID and ORIGIN
npm install
npx prisma migrate dev && npx prisma generate
npm run dev                   # API :3102, worker, Vite :5181
```

Open http://localhost:5181, create the vault with a passkey and **save the recovery code**.

Tests:

```sh
npm test                                  # crypto + worker end to end (needs ffmpeg)
npm run build && node scripts/e2e.mjs     # full browser test with a virtual PRF passkey
```

## Deployment

1. Copy `docker-compose.yml` and a `.env` (from `.env.example`, with your real `RP_ID`/`ORIGIN` and a long random `SESSION_SECRET`) to your server.
2. Build and ship the image: `NAS=user@host ./deploy/deploy.sh` (or put `NAS`, `SSH_KEY`, `NAS_DIR` in `deploy/.env.deploy`). It builds locally, sends the image over SSH and recreates the containers. Migrations run on start.
3. Put it behind HTTPS on a private network (e.g. `tailscale serve`).

Data lives in `DATA_DIR` (`/data` in the container). `boveda.json` + `videos/` + your recovery code are enough to recover everything, even if the database is lost. See [README.es.md](README.es.md#datos-data_dir) for the layout.

## Stack

Node 26 (TypeScript stripping), Express 5, Prisma 7 + SQLite, Vue 3 + Pinia + CoreUI, hls.js, tus, exifr, ffmpeg, Web Crypto API (same code in browser and server).

## Status

Personal project, used daily on a 4 GB ARM NAS. Issues and pull requests are welcome, but expect rough edges and a Spanish codebase.

## License

[AGPL-3.0](LICENSE). If you run a modified version as a service for others, you must publish your changes.
