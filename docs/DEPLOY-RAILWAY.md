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
| `XERO_REDIRECT_URI` | unused by the code (Xero connects as a Custom Connection via `/auth/connect`) |
| `SUPABASE_URL` | unchanged |
| `SUPABASE_SERVICE_ROLE_KEY` | unchanged |
| `JWT_SECRET` | unchanged |
| `CONNECT_SECRET` | the API key for the MCP server and scripts (`Authorization: Bearer …`). Never given to the web app. |
| `FLUX_LOGIN_SECRET` | this tool's login.flux.am secret: a reference to `${{flux-login.TOOL_SECRET_FLOATERS}}`. Unset means web sign-in is off and only the API key works. |

## 3. Generate a domain

- Railway → Settings → Networking → Generate Domain (e.g.
  `floaters-api-production.up.railway.app`), or attach a custom domain such as
  `api.floaters.flux.am`.

## 4. Xero

Xero connects as a Custom Connection (`GET /auth/connect?secret=<CONNECT_SECRET>`),
so it needs no redirect URI. `/auth/callback` is the login.flux.am sign-in.

## 5. The web app and sign-in

- The API serves the built web app itself (`npm run build` embeds it), so the
  web app is same-origin and needs no build variables. It holds no API key.
- Sign-in is login.flux.am. It sends Jim to
  `https://floaters.flux.am/auth/callback?code=…&next=…`, which sets the
  `__Host-floaters_session` cookie for 30 days. `GET /auth/logout` clears it.
- Cookie requests must carry `X-Floaters-Client: web` and, if they have an
  Origin, it must be this site. There is no CORS.

## 6. Verify

- `curl -H "Authorization: Bearer <CONNECT_SECRET>" https://<railway-domain>/api/sync-status`
  should return JSON instantly (no cold-start delay).
- Load the web app: it should send you to login.flux.am and back. Edit a
  projected cell: it should stick immediately (no-store + optimistic update)
  and survive a refresh.

## DNS (flux.am)

You only need DNS if you want pretty custom domains instead of the
`*.up.railway.app` / hosting-provider defaults. Two records, both **CNAME**, set
at your `flux.am` DNS provider:

| Host (subdomain) | Type | Points to | Purpose |
|---|---|---|---|
| `floaters` | CNAME | the target Railway shows under Settings → Networking → Custom Domain | the API and the web app |

Steps:

1. In Railway → service → Settings → Networking → **Custom Domain**, enter
   `floaters.flux.am`. Railway shows a CNAME target; add that as the
   `floaters` CNAME at your DNS provider. Railway provisions TLS
   automatically once the record resolves (a few minutes to a couple of hours).
2. Sign-in codes name the host (`aud`), so login.flux.am's tool entry must use
   the same hostname.

Notes:
- Apex (`flux.am` itself) can't take a CNAME — only use subdomains like
  `floaters.`, or your DNS provider's ALIAS/ANAME if you ever
  want the apex.
- Keep TTL low (e.g. 300s) during the switch so you can roll back fast.

## 7. Decommission Render

- Once verified, pause/delete the Render service so it isn't serving stale code.
