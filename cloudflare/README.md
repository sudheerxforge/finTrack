# finTrack API (Cloudflare Worker + R2)

The server the app talks to. It runs on Cloudflare, deployed from GitHub, so
there is nothing to run on your PC. It does everything `backend/` does, plus storage.

| Endpoint | |
|---|---|
| `GET /health` | up check |
| `POST /token` | single-use Gemini Live token for the voice assistant |
| `POST /ai/parse` | text or receipt photo (base64) → transactions |
| `POST /ai/insights` | short money tips |
| `POST /auth/forgot`, `POST /auth/verify` | emails a 6-digit PIN-reset code, then checks it |
| `PUT /backup`, `GET /backup` | save / load the app's JSON backup (max 5 MB) |
| `POST /receipts`, `GET/DELETE /receipts/:key` | receipt photos (max 5 MB) |

Every call except `/health` needs an `X-Device-Id` header (the app makes a random
32-character id once). Storage is per device (`devices/<id>/…`). Treat the id like
a password. The Gemini calls are rate limited to 10/min per device and per IP.

## Deploy from GitHub (one-time setup, about 10 minutes)

1. **Push this repo to GitHub** (branch `main`).
2. **Cloudflare account** (free): https://dash.cloudflare.com
   - Enable **R2** (Storage & databases → R2; needs a card on file but the free tier is plenty).
   - Note your **Account ID** (Workers & Pages page, right side).
   - Create an **API token**: My Profile → API Tokens → *Create Token* → template **Edit Cloudflare Workers**, then add the permission **Account → Workers R2 Storage → Edit**.
3. **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**, add:
   | Secret | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from step 2 |
   | `CLOUDFLARE_ACCOUNT_ID` | your account id |
   | `GEMINI_API_KEY` | your Gemini key |
4. **Actions tab → "Deploy API (Cloudflare Worker)" → Run workflow** (it also runs on every push that changes `cloudflare/`). It checks types, runs tests, creates the `fintrack-data` bucket, deploys, and sets the Gemini secret.
5. Your URL is `https://fintrack-api.<your-subdomain>.workers.dev` (subdomain: Workers & Pages → Overview). Open `/health`; it should say `{"status":"ok"}`.
6. Put that URL in `mobile/src/config.ts` as `API_URL`, rebuild the app.

### Forgot-PIN emails (optional)

The app's "Forgot PIN?" sends a 6-digit code by email through [Resend](https://resend.com).
1. Create a free Resend account and an API key.
2. Add it as a GitHub secret named `RESEND_API_KEY`, then re-run the workflow.
3. Without a verified sending domain, Resend only delivers to your own account email (sender `onboarding@resend.dev`). To email any user, verify a domain in Resend and add a `MAIL_FROM` secret like `FINTRACK <no-reply@yourdomain.com>` (`npx wrangler secret put MAIL_FROM`).

Until this is set, the app tells the user email reset isn't available and offers "erase data and start over" instead. Codes last 10 minutes, are single use, allow 5 tries, and only a hash is stored.

To change the Gemini key later, update the GitHub secret and re-run the workflow.
Optional: add an `APP_KEY` secret (`npx wrangler secret put APP_KEY`, and the same value in `config.ts`).

## Checks

```powershell
npm install
npm run check     # TypeScript
npm test          # handler logic in plain Node, in-memory R2 (Node 22.18+)
```

`wrangler dev` needs the Workers runtime, which crashed with an access violation
on the Windows preview build this was written on. It works on normal machines.
