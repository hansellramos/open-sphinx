# Bóveda

Bóveda privada de videos, cifrados de punta a punta, para la NAS (sobre **AirCore**: Express 5 + Prisma 7 + Vue 3/CoreUI, igual que tulicencia).

- **Entrar:** passkey (WebAuthn). La extensión **PRF** de la passkey da un secreto que abre la clave de la bóveda; nunca sale del navegador.
- **Cifrado:** la bóveda es un par X25519. El servidor solo tiene la **pública**. Cada video tiene su clave AES-256-GCM, sellada con la pública (ECDH efímero + HKDF). La privada solo existe descifrada en memoria del navegador.
- **Recuperación:** la privada también se guarda envuelta con un **código de recuperación** de 52 caracteres que se muestra una sola vez. Se pueden registrar varias passkeys.
- **Subida:** reanudable con tus. El archivo llega sin cifrar (por Tailscale/HTTPS) y queda en `subidas/` solo hasta que el worker lo procesa.
- **Worker (cola en SQLite):** `ffmpeg -c copy` → HLS fMP4 de ~6 s (sin recodificar), miniatura, cifra cada archivo, sella la clave, borra lo sin cifrar. Un trabajo a la vez, con `nice`/`ionice`.
- **Reproducción:** hls.js con un loader que descifra cada fragmento en el navegador (Web Crypto). En iPhone requiere iOS 17.1+.

## Desarrollo

```
cp .env.example .env   # y cambia SESSION_SECRET
npx prisma migrate dev && npx prisma generate
npm run dev            # API :3102, worker, Vite :5181 (las passkeys funcionan en localhost)
npm test               # cifrado + worker de punta a punta (ffmpeg)
npm run build && node scripts/e2e.mjs [libx264|libx265]   # Chrome con passkey virtual PRF
```

## Datos (`DATA_DIR`)

| Carpeta | Contenido |
|---|---|
| `db/boveda.db` | SQLite: passkeys, bóveda (pública + privada envuelta), videos, cola |
| `boveda.json` | Copia de la clave pública + privada envuelta con el código |
| `videos/<id>/` | `*.enc` cifrados, `index.m3u8` (solo nombres/duraciones) y `key.json` (clave sellada): autocontenida |
| `subidas/`, `tmp/` | **Sin cifrar, temporal**: se borra al procesar |
| `backups/` | Respaldo diario de la base (03:00+, 7 días) |

Con `boveda.json` + `videos/` + el código de recuperación se puede recuperar todo aunque se pierda la base.

## Despliegue en la NAS

`./deploy/deploy.sh`: ver `NAS-DOCS/boveda.md` en la NAS.
