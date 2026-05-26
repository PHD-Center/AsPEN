# aspen-auth Cloudflare Worker

Tiny auth gateway for the AsPEN members area. Sits between the static
AsPEN site (GH Pages) and the private `PHD-Center/aspen-members` repo.
Members log in by email magic-link; the worker validates the session
cookie and proxies file content from the private repo.

See `docs/MEMBERSHIP_DESIGN.md` in the AsPEN repo for the full
architectural rationale.

---

## One-time deploy

### 0 · Pre-reqs (already done by Daniel)

- Cloudflare account
- Resend account + API key (`re_…`)
- GitHub fine-grained PAT scoped to `PHD-Center/aspen-members`,
  Contents: Read-only
- `PHD-Center/aspen-members` private repo created with an initial
  `members.json` committed (see template in this README's appendix)

### 1 · Install wrangler + log in

```bash
# install wrangler globally (or use npx)
npm install -g wrangler

# log in (browser pop-up to authorise the CLI against your CF account)
wrangler login
```

### 2 · From this directory, install deps

```bash
cd workers/aspen-auth
npm install
```

### 3 · Push the three secrets

These prompt for the value, never store it in git.

```bash
wrangler secret put GITHUB_PAT
# paste the fine-grained PAT (github_pat_…)

wrangler secret put JWT_SECRET
# paste any random 32+ character string. Generate one with e.g.
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or use a password generator. Don't reuse another secret.

wrangler secret put RESEND_API_KEY
# paste the Resend API key (re_…)
```

### 4 · Deploy

```bash
wrangler deploy
```

Wrangler prints the live URL — something like
`https://aspen-auth.<your-account>.workers.dev`.

**Copy this URL.** You'll set it as `PUBLIC_WORKER_URL` in the AsPEN
site config (`src/data/site-config.ts`) so the static `/members/*`
pages know where to call.

### 5 · Quick smoke test (no AsPEN site needed)

```bash
# Should print: aspen-auth worker — ok
curl https://aspen-auth.<your-account>.workers.dev/

# Should always return {"ok":true} regardless of whether the email is real
curl -X POST https://aspen-auth.<your-account>.workers.dev/api/request-login \
  -H "Content-Type: application/json" \
  -d '{"email":"danielhttsai@gmail.com"}'

# If that email is in members.json as active/invited, the magic-link
# email arrives in your inbox. Click it — without the AsPEN site
# wired up yet, you'll land on a 404 page on phd-center.github.io/AsPEN
# but the cookie will be set on the right domain.
```

### 6 · After AsPEN site is wired

Once `src/data/site-config.ts` has the worker URL and you've deployed
the AsPEN site:

1. Open `https://phd-center.github.io/AsPEN/members/login`
2. Enter your email
3. Receive magic-link, click
4. Land on `/members/` with your name displayed (data fetched via
   `/api/me`)

---

## Adjusting after deploy

All non-secret config lives in `wrangler.toml [vars]` — you can edit
them in the Cloudflare dashboard (Workers → aspen-auth → Settings →
Variables) without re-running `wrangler deploy`. Most useful ones:

| Var | Why you'd change it |
|---|---|
| `SITE_BASE_URL` | AsPEN moves to a new domain → update so magic-link URLs use the new domain. |
| `ALLOWED_ORIGINS` | Same reason — CORS origin must match where the site is served from. |
| `SENDER_EMAIL` | Switch from `onboarding@resend.dev` to `noreply@aspensig.asia` once the Resend domain is DNS-verified. |
| `SESSION_DAYS` | Cookie lifetime. Default 30. |
| `MAGIC_LINK_MINUTES` | Magic-link validity. Default 15. |

Secrets (`GITHUB_PAT`, `JWT_SECRET`, `RESEND_API_KEY`) are rotated
with `wrangler secret put <NAME>` again — overwrites the old value.

---

## Appendix · initial `members.json` for the private repo

Commit this file to `PHD-Center/aspen-members/members.json` so the
worker has something to read on first run.

```json
[
  {
    "email": "danielhttsai@gmail.com",
    "name": "Daniel Tsai",
    "affiliation": "National Cheng Kung University",
    "country": "TW",
    "role": "academic",
    "status": "active",
    "joinedDate": "2026-05-27"
  }
]
```

Status values:
- `active`   — full access; magic-link sent; content fetches authorised
- `invited`  — magic-link sent, but `/api/content/*` returns 401 until status is flipped to `active`. Useful if you want to onboard before granting full access.
- `removed`  — treated as if the email isn't in the file. Keep the row so you have audit history.

Email match is case-insensitive.

---

## Appendix · troubleshooting

- **Magic-link email never arrives.** Check Resend dashboard → Logs.
  Most likely cause: `SENDER_EMAIL` domain not verified yet. Confirm
  it's still set to `onboarding@resend.dev` until DNS is added.
- **"Unauthorized" on /members/.** Session cookie missing or expired.
  Re-login. If it persists, check `JWT_SECRET` hasn't been rotated
  without re-issuing sessions.
- **404 from /api/content/.** Path traversal blocked, or file not in
  `papers/` or `materials/` (intentional whitelist).
- **GitHub 401 in worker logs.** `GITHUB_PAT` expired or revoked.
  Generate a new one (Settings → Developer settings → Fine-grained
  tokens) and `wrangler secret put GITHUB_PAT` again.

`wrangler tail` streams live worker logs — useful when debugging.
