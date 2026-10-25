# Deployment

[← README](../README.md) · [Architecture](architecture.md) · [API reference](api.md)

There are three pieces, and each can live anywhere:

- the **web app**: a folder of static files
- the **API**: a Node process
- **Postgres**

The repo is set up for a free combination (GitHub Pages, Render and Neon), and it moves to your own server without code changes.

## Free hosting: GitHub Pages + Render + Neon

1. **Database.** Create a free Postgres on [Neon](https://neon.tech) or [Supabase](https://supabase.com). Both have permanent free tiers; Render's own Postgres is deleted after 90 days. Copy the connection string, which ends in `?sslmode=require`. That turns on SSL automatically.

2. **A JWT secret.** It goes into Render, never into the repo:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

3. **API on Render** (a free web service):
   - Root directory: `backend`
   - Build: `npm install`
   - Start: `npm run migrate && npm start`. Every deploy applies new migrations first, so updating never needs manual database work.
   - Environment variables:
     - `DATABASE_URL`
     - `JWT_SECRET`
     - `CORS_ORIGIN`: your Pages URL. Add it after step 5.
     - the `SMTP_*` settings and `APP_URL`, so password resets are emailed. Without them, reset links only appear in Render's logs.
     - optionally `SNAPTRADE_*` and `REDDIT_*`
   - `TRUST_PROXY` is detected automatically on Render.
   - Don't run `npm run seed` here: it creates accounts with publicly known passwords.

4. **Web app on GitHub Pages:**
   - Repo **Settings → Pages → Source: GitHub Actions**.
   - **Settings → Secrets and variables → Actions → Variables:** add `VITE_API_URL` = `https://<your-api>.onrender.com/api`.
   - `.github/workflows/deploy-pages.yml` builds and publishes on every push to `main`, with `BASE_PATH` set to `/<repo-name>/`.

5. **Close the loop.** Set `CORS_ORIGIN` on Render to `https://<you>.github.io`, redeploy, then open the Pages URL and register.

**What the free tier means:**
- **Cold starts:** Render free services sleep after about 15 minutes, so the first request takes a few seconds. Neon also wakes slowly after it's been idle.
- **Public page:** Pages is public, so anyone can see the sign-in page. They still need an account to see anything else.
- **Hash URLs:** they look like `…/WebBudget/#/transactions`. That's the price of a static host with no rewrite rules.

## Receipt scanning when the API is in the cloud

Scanning calls Ollama from the **API**, not from the browser. An API on Render can't reach a model on your PC, so on the hosted site the scan button says scanning isn't available and you enter the transaction by hand. To make it work, do one of these:

- run the API at home next to Ollama (see self-hosting below), or
- expose Ollama to the API through a private tunnel (Tailscale or Cloudflare Tunnel) and set `OLLAMA_URL` to it. Never expose Ollama on the open internet.

## Moving to your own server

Nothing is tied to Pages, Render or Neon.

1. **Database:** copy everything across. Accounts and data come over as they are.
   ```bash
   pg_dump "<old connection string>" > ledger.sql
   psql "<new connection string>" < ledger.sql
   ```
2. **API:** run `backend/` with `npm run migrate && npm start` and these settings:
   - `DATABASE_URL`
   - the **same** `JWT_SECRET`, or everyone simply signs in again
   - `CORS_ORIGIN` set to the new site. It accepts a comma-separated list, so the old and new sites can both work while you switch.
   - `TRUST_PROXY=1` behind nginx, Caddy or Cloudflare Tunnel.
3. **Web app:** serve `frontend/dist/` from any web server (Caddy, nginx, or the same box as the API).
   ```bash
   cd frontend
   VITE_API_URL=https://<your-api>/api npm run build    # leave BASE_PATH unset for a site at /
   ```
   With the API on the same domain under `/api`, use `VITE_API_URL=/api`. The service worker never caches `/api/`.

## Installing on a phone

Ledger is an installable web app: it gets its own home-screen icon and opens full screen. There's no app store.

- **iPhone (Safari):** open the site → Share → **Add to Home Screen**.
- **Android (Chrome):** open the site → ⋮ → **Install app**. Chrome may also offer it in a banner.

The pieces live in `frontend/public/`:
- `manifest.webmanifest`: the app's name, colours and icons, with relative paths so it works under `/WebBudget/` or at `/`.
- `icons/`: the home-screen icons.
- `sw.js`: the service worker. Pages are fetched from the network first, built assets are cached, and API requests are never cached.

`src/main.jsx` registers the service worker in production builds only. Updating is just deploying again; there's nothing to reinstall.

Two things to know:

- **Installing needs HTTPS.** The Pages site already has it. At home, plain `http://192.168.x.x` can't be installed. Easy options:
  - `tailscale serve`, which gives the machine an HTTPS address on your own devices
  - Cloudflare Tunnel
  - a domain pointed at Caddy, which gets certificates by itself
- **An installed app belongs to its address.** If the site moves, remove the old icon, install from the new address and sign in again. Nothing is lost; it's all in the database.

For quick testing on a phone without installing, run the dev server on your network with `npm run dev:lan`, and open `http://<your-PC's-IP>:5173` on a phone on the same Wi-Fi.

## Upgrading

Pull the new code and restart the API (or redeploy). Migrations not yet applied run on start; your data is never reset.
