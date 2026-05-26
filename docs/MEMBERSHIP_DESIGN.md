# AsPEN membership & member-area design

**Status:** Phase 1 shipped (public application page). Phase 2 (auth-gated `/members/` area) is ready to build once the small Cloudflare Worker piece is provisioned — site itself stays on GH Pages.
**Last revised:** 2026-05-27.

## Goals

1. **Members reach full text for AsPEN papers they need.** Today, ~56% of papers (24 / 43) have a free PMC mirror that we link publicly. For the rest, Phase 2 ships an author-supplied AAM library inside `/members/`.
2. **AsPEN hosts its own internal materials in one place** — study protocols, analysis code, slide decks, member directory.
3. **Vetted self-signup.** Anyone in the pharmacoepi community can apply; the Chair / Academic & Education office approves.
4. **Manageable by 1–2 people.** No standing infrastructure to babysit.
5. **Members stay on the AsPEN site.** No redirects to github.com or another vendor's login page.
6. **Backend lives in GitHub.** Membership list, materials, AAM library — all git-tracked, chair edits via PagesCMS or git directly.

## Hard constraints

- **Copyright.** AsPEN does not and will not host publisher PDFs of paywalled papers, even behind a login. Republishing journal-formatted PDFs without an institutional licence breaches almost every publisher agreement. The legal channels for the same content are: (a) PMC mirrors when present; (b) author-shared AAMs (typically allowed 6–12 months post-publication under funder mandates); (c) preprints; (d) author-courtesy peer copies on individual request. The Phase 2 library only hosts content under (b)–(d) with explicit author/publisher permission.
- **GH Pages is a static host.** It can't run server-side auth on its own — anything that pretends to gate content client-side is theatre. So Phase 2 needs ONE small piece of compute somewhere. We use a free Cloudflare Worker.
- **No GitHub account required of members.** Members log in via email magic-link on the AsPEN site. They never see github.com.

## Phase 1 — shipped on GH Pages

- **`/membership/` page** — describes who can join, what membership unlocks, how vetting works, and a single "Apply to join AsPEN" button that opens a pre-filled mailto to the Chair + Academic & Education office.
- **Footer link** — "Become a member" leads the "Get involved" column.
- **No fake gating.** Everything visible to a member today is also visible to the public. The only difference is the application flow.

## Phase 2 — architecture (recommended)

```
Member browser
    │
    │ 1. visits aspensig.asia/members/
    │ 2. JS sees no cookie → redirect to /members/login
    │ 3. enters email → POST to worker /api/request-login
    │ 4. clicks magic-link → /members/verify?t=…
    │ 5. JS POSTs token → worker /api/verify → sets HttpOnly cookie
    │ 6. JS fetches member content → worker /api/content/{path}
    ▼
┌─────────────────────────────────────────────────┐
│  AsPEN site on GH Pages (unchanged hosting)     │
│  - /, /about/, /databases/, ... public          │
│  - /members/*           client-side gated       │
└─────────────────────────────────────────────────┘
              │
              │ fetch() calls
              ▼
┌─────────────────────────────────────────────────┐
│  Cloudflare Worker (~150 LOC, free tier)        │
│  - POST /api/request-login                      │
│  - GET  /api/verify                             │
│  - GET  /api/content/{path}                     │
│  Secrets: GITHUB_PAT, JWT_SECRET, RESEND_API_KEY│
└─────────────────────────────────────────────────┘
              │
              │ GitHub REST API (PAT)
              ▼
┌─────────────────────────────────────────────────┐
│  PHD-Center/aspen-members  (private repo)       │
│  - members.json                                 │
│  - papers/  (author-shared AAMs)                │
│  - materials/{protocols,slides,code}/           │
└─────────────────────────────────────────────────┘
```

### Why this shape

- **Members stay on AsPEN.** Login UX is just an email field + a click on a magic-link in their inbox. No github.com redirect.
- **Backend is GitHub.** members.json + materials live in `PHD-Center/aspen-members` (private). Chair edits via PagesCMS or directly via git. Full audit trail. No standing database to back up.
- **Site stays on GH Pages.** No DNS change, no host migration. The Worker is just one URL behind the scenes — `auth.aspensig.asia` or `aspen-auth.<account>.workers.dev`.
- **Total recurring cost: $0.** Cloudflare Worker free tier is 100K requests/day; Resend free tier is 3K emails/month — both well above what a vetted SIG of <200 needs.

### Member UX flow

1. Visits `/members/` → no cookie → redirected to `/members/login`.
2. Enters email address.
3. Worker checks email against members.json:
   - If found + status `active` or `invited`: issues a short-lived signed token, calls Resend, member receives a magic-link email.
   - If not found: silent no-op (don't leak membership status). Generic success message.
4. Member clicks magic-link → `/members/verify?t=<token>` on AsPEN site.
5. Static JS POSTs the token to worker `/api/verify`. Worker validates the JWT signature + expiry, returns a session cookie (HttpOnly, 30-day sliding).
6. Static JS redirects to `/members/`. Subsequent member-content fetches go through worker `/api/content/{path}`.

### Chair UX flow

1. Application email arrives. Chair vets.
2. If approved: chair opens PagesCMS → `aspen-members` repo → `members.json` → add a row `{ email, name, affiliation, country, role, status: "invited", joinedDate }`.
3. Commit. Member is now in the system. (Optionally: worker can auto-send a welcome email when new `invited` records show up on commit; or chair just tells the member.)
4. Adding materials: chair drops AAM PDFs into `papers/` directory of the private repo via PagesCMS or git. Folder structure controls navigation.

### What the Worker does (concretely)

`~150 LOC TypeScript`, three routes:

| Route | Method | Purpose |
|---|---|---|
| `/api/request-login` | POST `{ email }` | Look up email in members.json (GitHub Contents API, PAT-authenticated). If active/invited, sign a 15-minute JWT and send via Resend. Always return 200 OK (no enumeration). |
| `/api/verify` | POST `{ token }` | Verify JWT signature + expiry + email-match. Issue a 30-day session cookie. Update last-login in members.json (optional). |
| `/api/content/{path}` | GET (cookie) | Validate session cookie. Fetch the file from `aspen-members` repo via Contents API. Stream back to client. |

Secrets stored in Worker dashboard (never reach the static site):
- `GITHUB_PAT` — fine-grained token, scoped to `PHD-Center/aspen-members`, Contents:Read + Read access.
- `JWT_SECRET` — 32+ random bytes for signing magic-link and session tokens.
- `RESEND_API_KEY` — for the magic-link email.

### Data files

**`PHD-Center/aspen-members/members.json`** (private repo, never bundled into the public AsPEN build):
```json
[
  {
    "email": "member@example.edu",
    "name": "Member Name",
    "affiliation": "University X",
    "country": "TW",
    "role": "academic",
    "status": "active",
    "joinedDate": "2026-06-01"
  }
]
```
- `status`: `active | invited | removed`. Worker treats `removed` as if email is unknown.
- Email match is case-insensitive.

**`PHD-Center/aspen-members/papers/`**: author-shared AAMs, file-per-paper, filename based on PMID (e.g. `pmid-23653370.pdf`). README in the directory documents which papers AsPEN has licence to host.

**`PHD-Center/aspen-members/materials/`**: nested folders for `protocols/`, `slides/`, `code/`. Free-form structure — worker just lists and serves.

### Migration runbook (when ready to build)

1. **Cloudflare account + Worker.** Sign in to Cloudflare, create a new Worker project (`aspen-auth`). Empty for now.
2. **Resend account.** Sign up at resend.com, verify a sending domain (or use Resend's onboarding sandbox initially), grab the API key.
3. **Private repo.** Create `PHD-Center/aspen-members` (private). Initial commit: empty `members.json: []`, README explaining the structure.
4. **Fine-grained PAT.** GitHub Settings → Developer settings → Fine-grained tokens. Scope to `PHD-Center/aspen-members` only, Contents:Read.
5. **Worker secrets.** `wrangler secret put GITHUB_PAT`, `wrangler secret put JWT_SECRET`, `wrangler secret put RESEND_API_KEY`.
6. **Worker code.** Write the 3 routes (~150 LOC). Test with `wrangler dev`. Deploy to `aspen-auth.<account>.workers.dev`. Optionally bind a custom domain like `auth.aspensig.asia`.
7. **AsPEN site changes.** Add `src/pages/members/{index,login,verify,papers,materials}.astro`. Each calls the worker URL via fetch(). Worker URL is a build-time env var so it's not hard-coded.
8. **PagesCMS extension.** Add a second collection in `.pages.yml` pointing at the private repo (or set up a second PagesCMS site instance for it). Chair gets access to edit `members.json` via web UI.
9. **First member.** Add chair's own email as a smoke test, run the full flow.
10. **Announce.** Update `/membership/` page to point at the live login flow.

### Open questions for chair to weigh in on

- **Member directory** — public, members-only, or opt-in per member? Default proposal: opt-in per member (a `directoryOpt` boolean on each record).
- **Self-serve email update / removal** — should members be able to update their own email or leave via the member area, or all changes through chair? Simpler: chair-only for now.
- **AAM curation** — author-driven (each author sends their own paper copies to the chair, who commits) seems cleanest legally. Worth documenting on the `/membership/` page so authors understand what's expected.

### Alternative considered: Cloudflare Pages + Cloudflare Access

This was the original Phase 2 plan: migrate the entire site from GH Pages to Cloudflare Pages and put Cloudflare Access in front of `/members/*`. Pros: zero auth code, allowlist managed in CF dashboard. Cons: members.json doesn't exist as a git-tracked file (CF dashboard is the source of truth), and the site has to migrate hosts. The Worker+GitHub design above achieves the same security guarantee with members.json git-tracked, no host migration, slightly more code. Kept on file as a fallback if the Worker route hits an unexpected blocker.

## What this means for code today

- The existing `src/pages/membership.astro` is fine — it's the public application page. Phase 2 will add `src/pages/members/*.astro` alongside it.
- The `fulltext` field on the publications schema (currently unused) is the right place for author-supplied free-text URLs that *are* publicly shareable. Adding entries shrinks the gap for everyone, member or not.
- `members.json` doesn't exist in this repo and never will — it lives in the private `aspen-members` repo so emails never end up in this public repo's git history.
- `workers/` directory doesn't exist yet either. When Phase 2 is built, the worker can live in a sibling repo `aspen-auth-worker` (separate deploy lifecycle) rather than crowding the website repo.
