# Deploying the API to Railway

Moving the API off Render's free tier (which spins down after ~15 min idle and
cold-starts for 30–60s) onto Railway (always-on) is the single biggest speed
win. The repo is already configured — `railway.json` at the root builds and
starts the `@floaters/api` workspace.

This is a guided, one-time migration because it touches the live site, Xero, and
secrets. Do it in this order.

## 1. Create the Railway service

- New project → Deploy from GitHub repo → `jimflux/floaters`, branch `spring-clean`
  (or `main` once merged).
- Railway picks up `railway.json` automatically:
  - Build: `npm install && npm run build:api`
  - Start: `npm run start --workspace @floaters/api` (binds to `$PORT`)
- Leave Root Directory as the repo root (the build needs the npm workspace so
  `@floaters/types` resolves).

## 2. Set environment variables (Railway → Variables)

Copy the values from the current Render service / `apps/api/.env`:

| Variable | Notes |
|---|---|
| `XERO_CLIENT_ID` | from Xero app |
| `XERO_CLIENT_SECRET` | from Xero app |
| `XERO_REDIRECT_URI` | set to the new Railway URL + `/auth/callback` (see step 4) |
| `SUPABASE_URL` | unchanged |
| `SUPABASE_SERVICE_ROLE_KEY` | unchanged |
| `JWT_SECRET` | unchanged |
| `CONNECT_SECRET` | unchanged — must match the web `VITE_API_KEY` |
| `FRONTEND_URL` | the deployed web URL (for CORS) |

## 3. Generate a domain

- Railway → Settings → Networking → Generate Domain (e.g.
  `floaters-api-production.up.railway.app`), or attach a custom domain such as
  `api.floaters.flux.am`.

## 4. Update Xero redirect URI

- In the Xero developer portal, add the new callback URL
  `https://<railway-domain>/auth/callback` to the app's redirect URIs.
- Set `XERO_REDIRECT_URI` in Railway to the same value.

## 5. Repoint the web app

- Set the web build env (wherever the web is hosted — Lovable/Vercel/etc.):
  - `VITE_API_URL=https://<railway-domain>`
  - `VITE_API_KEY=<CONNECT_SECRET>`
- Rebuild/redeploy the web app. The CORS allow-list in
  `apps/api/src/middleware.ts` already includes the Lovable/flux.am origins; add
  the web origin there if it differs.

## 6. Verify

- `curl -H "Authorization: Bearer <CONNECT_SECRET>" https://<railway-domain>/api/sync-status`
  should return JSON instantly (no cold-start delay).
- Load the web app, edit a projected cell — it should stick immediately
  (no-store + optimistic update) and survive a refresh.

## DNS (flux.am)

You only need DNS if you want pretty custom domains instead of the
`*.up.railway.app` / hosting-provider defaults. Two records, both **CNAME**, set
at your `flux.am` DNS provider:

| Host (subdomain) | Type | Points to | Purpose |
|---|---|---|---|
| `api.floaters` | CNAME | the target Railway shows under Settings → Networking → Custom Domain | the API |
| `floaters` | CNAME | your web host's domain (Lovable/Vercel target) | the web app |

Steps:

1. In Railway → service → Settings → Networking → **Custom Domain**, enter
   `api.floaters.flux.am`. Railway shows a CNAME target — add that as the
   `api.floaters` CNAME at your DNS provider. Railway provisions TLS
   automatically once the record resolves (a few minutes to a couple of hours).
2. For the web app at `floaters.flux.am`, point the `floaters` CNAME at whatever
   host serves the built web app and add the domain there too.
3. After DNS resolves, set:
   - `XERO_REDIRECT_URI=https://api.floaters.flux.am/auth/callback` (and add it
     in the Xero portal)
   - `FRONTEND_URL=https://floaters.flux.am`
   - web `VITE_API_URL=https://api.floaters.flux.am`
4. `apps/api/src/middleware.ts` already allows `https://floaters.flux.am`; if you
   pick a different web hostname, add it to `ALLOWED_ORIGINS` there.

Notes:
- Apex (`flux.am` itself) can't take a CNAME — only use subdomains like
  `floaters.` / `api.floaters.`, or your DNS provider's ALIAS/ANAME if you ever
  want the apex.
- Keep TTL low (e.g. 300s) during the switch so you can roll back fast.

## 7. Decommission Render

- Once verified, pause/delete the Render service so it isn't serving stale code.
