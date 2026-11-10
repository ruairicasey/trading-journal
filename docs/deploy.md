# Deploying (Vercel + Turso + Cloudflare R2)

The code is public. Your data lives in **your** Turso database and **your** private R2 bucket, and every page and
API route sits behind your password. Follow the steps in order. **Never paste a key, token, password or hash
into a chat, an issue, a commit or a screenshot.** Put them only in your terminal, a password manager, the
Vercel dashboard and GitHub's Actions secrets.

You'll collect these values. Keep them in your password manager as you go:

| Variable | Where it comes from |
|---|---|
| `AUTH_PASSWORD_HASH` | `npm run hash-password` (step 1) |
| `AUTH_SECRET`, `CRON_SECRET` | `npm run gen-secret` (step 1) |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN` | Turso (step 2) |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Cloudflare (step 3) |

## 1. Generate your password hash and secrets (on your Mac)

```bash
npm run hash-password
```
```bash
npm run gen-secret
```

- `hash-password` asks for your password twice (hidden) and prints one line: the variable name `AUTH_PASSWORD_HASH`, an equals sign, and a hash starting with `scrypt:`. Use 12+ characters, ideally a passphrase. Only the hash is stored anywhere; the password itself is never saved.
- `gen-secret` prints random `AUTH_SECRET` and `CRON_SECRET` values.
- Optional: to also require login locally, put `AUTH_PASSWORD_HASH` and `AUTH_SECRET` in `.env.local`.

## 2. Turso database

Using the Turso CLI (`brew install tursodatabase/tap/turso`):

```bash
turso auth login
```
```bash
turso db locations
```
```bash
turso db create trading-journal --location <closest, e.g. syd>
```
```bash
turso db show trading-journal --url
```
```bash
turso db tokens create trading-journal
```

- The `--url` output (`libsql://…`) is `DATABASE_URL`.
- The token output is `DATABASE_AUTH_TOKEN`.
- Tables are created automatically on the first Vercel build (the build runs migrations before `next build`).

## 3. Cloudflare R2 bucket (screenshots)

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**, named e.g. `trading-journal-screenshots`. Pick a location hint near you (Oceania).
2. In the bucket's **Settings**: leave **Public access disabled**. Do **not** enable the `r2.dev` subdomain or add a custom domain. The app serves images only through its own logged-in route.
3. R2 overview → **Manage API tokens** → **Create API token**:
   - permission **Object Read & Write**
   - **Apply to specific buckets only** → your bucket
   - copy the **Access Key ID** and **Secret Access Key** (shown once)
4. Your **Account ID** is shown on the R2 overview page.

`R2_BUCKET` is the bucket name.

## 4. Vercel project

1. vercel.com → **Add New… → Project** → import `ruairicasey/trading-journal`. Framework preset: Next.js. Leave the build command as default: Vercel runs the repo's `vercel-build` script, which applies migrations and then builds.
2. **Before the first deploy**, open **Environment Variables** and add each variable below. **Tick only "Production"** (untick Preview and Development) and mark secrets as **Sensitive**:

   | Name | Value |
   |---|---|
   | `AUTH_PASSWORD_HASH` | from step 1 |
   | `AUTH_SECRET` | from step 1 |
   | `CRON_SECRET` | from step 1 |
   | `DATABASE_URL` | from step 2 |
   | `DATABASE_AUTH_TOKEN` | from step 2 |
   | `STORAGE_DRIVER` | `r2` |
   | `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from step 3 |
   | `APP_TIMEZONE` | `Australia/Melbourne` |

   Leave `HL_WALLET_ADDRESS` out; you'll add the wallet in the app after logging in.
3. **Settings → Deployment Protection**: enable **Vercel Authentication** for **preview deployments** (Standard Protection). Previews also have no env vars, so they show "Preview deployments have no data access" even if someone gets past that.
4. **Settings → Functions → Function Region**: pick the region closest to your Turso database (e.g. Sydney, `syd1`).
5. **Deploy.** In the build log you should see `db-setup: migrations applied, defaults seeded`.

If a required value is missing, every route returns **503 "Server misconfigured: …"**: the app fails closed rather than running unprotected.

## 5. Check it's locked down

Replace `<app>` with your production domain. These need no secrets:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<app>/dashboard
```
Expect `307` (redirect to `/login`).

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<app>/api/sync
```
Expect `401`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<app>/api/sync/cron
```
Expect `401`.

Then open `https://<app>`, sign in, go to **Settings → Wallets & sync**, add your wallet, and press **Sync now**. The first import runs in roughly 40-second chunks and continues automatically until done.

## 6. Scheduled sync

- **Vercel Cron** (in `vercel.json`) calls `/api/sync/cron` once a day as a backstop. Vercel sends `CRON_SECRET` automatically.
- **GitHub Actions** (`.github/workflows/sync-cron.yml`) calls it hourly (at minute :17). In GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**, add:
  - `SYNC_URL` = `https://<app>/api/sync/cron`
  - `CRON_SECRET` = the same value as in Vercel
  
  Then **Actions → Scheduled sync → Run workflow** once and check it goes green.
- The workflow never prints the URL, the secret or the response (Actions logs on a public repo are public).
- GitHub disables scheduled workflows after 60 days without repo activity. The app shows a **Stale** warning when no sync has succeeded for 3 hours (hourly runs plus GitHub's occasional delays); if the workflow was disabled, re-enable it under Actions.

## If a secret leaks

Regenerate it (`npm run gen-secret`, `npm run hash-password`, `turso db tokens create …`, or a new R2 token), update it in Vercel (and GitHub for `CRON_SECRET`), and redeploy. Changing `AUTH_SECRET` signs out every existing session.
