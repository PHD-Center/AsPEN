# AsPEN site — handoff for IT

**One-page reference for an IT department that wants to understand,
back up, mirror, or take over operation of the AsPEN web platform.**

> Current setup is fully functional and being actively developed. The
> primary chair (Daniel Tsai, NCKU) intends to keep doing iterative
> development against PHD-Center's GitHub repos as the source of truth.
> The recommended pattern: **IT keeps a mirror / has read access for
> audit and backup; primary dev velocity remains with the chair.** If
> IT later wants to fully self-host or rebuild on different
> infrastructure, this doc lists everything needed to do so.

**Last revised:** 2026-05-27.
**Site URL today:** https://phd-center.github.io/AsPEN/
**Planned domain:** https://aspensig.asia (DNS migration pending).

---

## 1 · Architecture in one picture

```
                    Member browser
                          │
                          │  visits aspensig.asia
                          ▼
        ┌──────────────────────────────────────────┐
        │  AsPEN site (Astro 5, static)             │
        │  Source: PHD-Center/AsPEN  (PUBLIC)        │  ← public website
        │  Hosting: GitHub Pages                     │
        │  Build: GitHub Actions (.github/workflows) │
        │  Pages: /, /about, /databases, /publications│
        │         /activities, /contact, /membership, │
        │         /nhird (Taiwan data infrastructure), │
        │         /members/* (gated by Worker below)  │
        └──────────────────────────────────────────┘
                          │
                          │  /members/* JS does cross-origin fetch
                          ▼
        ┌──────────────────────────────────────────┐
        │  aspen-auth Cloudflare Worker             │
        │  Lives on Cloudflare (NOT GitHub Pages)    │  ← auth gateway
        │  Source code: workers/aspen-auth/ inside   │
        │              PHD-Center/AsPEN repo         │
        │  URL: aspen-auth.danielhttsai.workers.dev  │
        │  Routes: magic-link login, sessions,        │
        │          reading-group state, file proxy,   │
        │          admin actions                     │
        │  Secrets (in CF dashboard):                │
        │    · GITHUB_PAT   — read+write aspen-members│
        │    · JWT_SECRET   — signs session cookies   │
        │    · RESEND_API_KEY — sends magic-link mail │
        └──────────────────────────────────────────┘
                          │
                          │  GitHub REST API
                          ▼
        ┌──────────────────────────────────────────┐
        │  PHD-Center/aspen-members  (PRIVATE repo) │  ← members + data
        │  members.json      — emails, names, status │
        │  reading.json      — reading-group picks, │
        │                      reactions, takes,    │
        │                      comments             │
        │  suggestions.json  — open paper suggestions│
        │  papers/           — (currently empty)     │
        │  materials/        — protocols, slides, code│
        │  pending/          — in-review uploads     │
        └──────────────────────────────────────────┘

        ┌──────────────────────────────────────────┐
        │  Resend (separate vendor)                  │
        │  Sends magic-link emails from              │
        │  noreply@aspensig.asia (once domain        │
        │  verified — sandbox onboarding@resend.dev  │
        │  in use until then)                        │
        └──────────────────────────────────────────┘
```

**Why three pieces, not one?** The public site is a static HTML/CSS/JS
bundle (host-anywhere). The auth and members area need a small server
component (the Worker) because static hosts can't safely hold the
GitHub PAT. The private repo is a git-tracked database — chair can
audit every change to membership and content via git history.

---

## 2 · Inventory · everything that exists

| Component | URL / location | Visibility | Owner |
|---|---|---|---|
| Public site source | https://github.com/PHD-Center/AsPEN | Public | PHD-Center org |
| Live public site (GH Pages) | https://phd-center.github.io/AsPEN/ | Public | served from above |
| Auth worker source | `workers/aspen-auth/` inside above repo | Public | (same) |
| Deployed worker | https://aspen-auth.danielhttsai.workers.dev | Public endpoint (CORS-gated) | Daniel's Cloudflare |
| Private data repo | https://github.com/PHD-Center/aspen-members | **Private** | PHD-Center org |
| Email vendor | https://resend.com/ — domain `aspensig.asia` | Vendor account | Daniel's Resend |
| DNS for aspensig.asia | (registrar TBC by IT) | DNS provider | TBC |
| GH Pages CI | `.github/workflows/deploy.yml` | In public repo | runs on every push to main |
| Worker CI | none — `wrangler deploy` from local | Manual | currently chair runs |

### Files that contain real personal data
- `PHD-Center/aspen-members/members.json` — member emails, names,
  affiliations, optional `passwordHash` (PBKDF2-SHA256, 100k iterations).
- `PHD-Center/aspen-members/reading.json` — public reactions and shared
  takes are visible to all members; private takes are member-only.
- `PHD-Center/aspen-members/pending/**/meta.json` — uploader email per
  pending submission.

Whoever has access to the **aspen-members** repo can read every
member's email. Worker's GitHub PAT can also be used to read it from
the API.

### Secrets — never in git, never in chat

| Secret | Where | What it does | Rotation impact |
|---|---|---|---|
| `GITHUB_PAT` | Cloudflare Worker secret store | Worker reads/writes aspen-members repo | Rotate without warning. Worker fails until updated. |
| `JWT_SECRET` | Cloudflare Worker secret store | Signs session cookies | Rotating invalidates every existing session. All members must log in again. |
| `RESEND_API_KEY` | Cloudflare Worker secret store | Sends magic-link emails | Rotating breaks magic-link sends until updated. |
| Cloudflare account password / 2FA | Daniel | Owns worker + secrets | Loses ability to deploy / change worker. |
| Resend account password / 2FA | Daniel | Owns sender domain | Loses ability to send / change senders. |
| GitHub account | Daniel (org admin on PHD-Center) | Pushes to both repos | Loses commit access. |

---

## 3 · For IT: three ways to "have" this system

### A · Read-only mirror / backup (lowest friction)

Goal: IT has a copy of everything for audit / disaster recovery, but
does not run the system day-to-day.

1. **Mirror both GitHub repos** to IT's own Git server:
   ```bash
   git clone --mirror https://github.com/PHD-Center/AsPEN.git
   git clone --mirror https://github.com/PHD-Center/aspen-members.git
   ```
   Repeat periodically (cron, or set up GitHub Actions to push to
   IT's git mirror on every commit).
2. **Document Cloudflare + Resend access** in IT's password vault
   (Daniel shares credentials with the IT admin).
3. **No DNS change required.** aspensig.asia DNS still points at
   GitHub Pages (or wherever you settle).
4. **IT does nothing day-to-day.** Chair pushes to PHD-Center repos as
   normal; mirror updates automatically.

### B · IT hosts the public site, dev still on PHD-Center (recommended hybrid)

Goal: aspensig.asia served from IT's web server (compliance / "our
infrastructure"), but chair keeps fast dev velocity on GitHub.

1. Steps from A, plus:
2. Set up a GitHub Actions job in PHD-Center/AsPEN that, on every push
   to main: runs `npm run build`, then uploads `dist/` to IT's server
   (rsync over SSH, S3 sync, FTP, whatever IT prefers). IT provides
   credentials as GitHub secrets.
3. Point aspensig.asia DNS at IT's server.
4. Update **two** Cloudflare Worker env vars to match new domain:
   - `SITE_BASE_URL` → `https://aspensig.asia`
   - `ALLOWED_ORIGINS` → `https://aspensig.asia` (CORS for the
     /members/* fetches)
5. Worker, private repo, Resend stay where they are. Magic-link emails
   still route correctly. Members area still works.

Site lifecycle:
- Chair pushes code → GH Actions builds + ships to IT server → live.
- IT can also pull / inspect at any time.

### C · IT fully takes over (full migration)

Goal: IT operates the entire stack. Chair hands off and stops being
in the loop.

1. Transfer ownership of GitHub repos to IT's org (GitHub Settings →
   Transfer ownership), or have IT fork and treat their fork as
   source of truth. Chair loses push access (or stays as collaborator).
2. Transfer the Cloudflare account that hosts the Worker to IT (or
   have IT recreate from `workers/aspen-auth/` source — same code,
   new account, new URL).
3. Transfer Resend account similarly.
4. IT rotates `JWT_SECRET` after takeover (forces all members to re-login,
   which is a clear signal of administrative handover).
5. IT updates the Worker secrets, env vars, and `WORKER_URL` in
   `src/data/site-config.ts` to match the new Worker URL.
6. DNS is wholly IT's.

This is irreversible without redoing all the steps. **Not
recommended unless IT is genuinely operating the platform long-term.**

---

## 4 · Rebuild-from-scratch runbook (if all current infrastructure vanished)

Given only the two GitHub repos + this doc, IT can rebuild the
entire system. Procedure:

1. **Public site**: clone PHD-Center/AsPEN, `npm install`,
   `npm run build`. Deploy `dist/` to any static host (GH Pages,
   Cloudflare Pages, Netlify, S3 + CloudFront, IT's own Nginx).
2. **Worker**: clone the same repo, `cd workers/aspen-auth`,
   `npm install`. Create a Cloudflare account (free tier works).
   `wrangler login`. `wrangler secret put GITHUB_PAT` (fine-grained
   PAT scoped to aspen-members repo, Contents Read+Write).
   `wrangler secret put JWT_SECRET` (32 random bytes hex).
   `wrangler secret put RESEND_API_KEY` (from Resend dashboard).
   Edit `wrangler.toml` env vars for new domain. `wrangler deploy`.
3. **Private data repo**: PHD-Center/aspen-members can be cloned by
   anyone with read access. Recreate the repo on IT's git server if
   needed; copy `members.json` and other JSON files over.
4. **Resend**: sign up at resend.com, verify the sending domain
   (DNS records: SPF, DKIM, MX, DMARC — Resend dashboard provides
   exact values). Generate API key, push as Worker secret.
5. **Wire**: update `src/data/site-config.ts` with the new Worker URL,
   rebuild site, deploy.
6. **Smoke test**: visit `/members/login`, request magic-link with
   chair's email, click link, verify dashboard loads.

Total time: ~2-4 hours assuming all accounts exist and DNS is
controllable.

---

## 5 · How the chair plans to keep developing

- All future commits go to **PHD-Center/AsPEN** main branch.
- GH Pages auto-deploys (or, in scenario B, IT's CI receives the
  built artifacts).
- IT mirror should pull periodically (cron, or GitHub webhook → IT's
  repo).
- Worker updates: chair runs `wrangler deploy` from local `workers/aspen-auth/`.
  IT does not need to redeploy in lockstep — Worker only changes when
  endpoints change.
- Member additions / reading-group picks / content review: done by
  chair (+ admin members) via the in-site admin UI; writes to
  aspen-members repo via Worker. No IT involvement required.

## 6 · Contact

Primary maintainer: Daniel Tsai (danielhttsai@gmail.com), NCKU.
Co-lead: Edward Lai (edward_lai@mail.ncku.edu.tw), NCKU.
Chair: Ju-Young Shin, SKKU/SNU.
