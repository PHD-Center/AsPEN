# AsPEN membership & member-area design

**Status:** Phase 1 shipped (public application page + per-paper "Request from authors"). Phase 2 (real auth-gated member area) is unblocked the moment AsPEN moves off GH Pages.
**Last revised:** 2026-05-27.

## Goals

1. **Members can reach full text for every AsPEN paper they need.** Today, ~56% of papers (24 / 43) have a free PMC mirror that we link publicly. For the remaining ~44%, members should be able to obtain a copy without scraping or piracy.
2. **AsPEN can host its own internal materials in one place.** Author-Accepted Manuscripts (AAMs), preprints, study protocols, analysis code, slide decks, member directory — gated by login.
3. **Vetted self-signup.** Anyone in the pharmacoepi community can apply; the Chair / Academic & Education office approves.
4. **Manageable by 1–2 people.** No standing infrastructure to babysit.

## Hard constraints

- **Copyright.** AsPEN does not and will not host publisher PDFs of paywalled papers, even behind a login. Republishing journal-formatted PDFs without an institutional licence breaches almost every publisher agreement. The legal channels for the same content are: (a) PMC mirrors when present; (b) author-shared AAMs (typically allowed 6–12 months post-publication under funder mandates); (c) preprints; (d) author-courtesy peer copies on individual request. Phase 2 only hosts content under (b)–(d) with explicit author/publisher permission.
- **GH Pages today, different host later.** We can't run server-side auth on GH Pages — anything that pretends to gate content client-side is theatre. The full auth gate waits for the host change.

## Phase 1 — what shipped today on GH Pages

- **`/membership/` page** — describes who can join, what membership unlocks (now vs. Phase 2), how vetting works, and a single "Apply to join AsPEN" button that opens a pre-filled mailto to the Chair + Academic & Education office.
- **"Request full text" button** on every publication card without a PMC mirror or `fulltext` URL. Opens a pre-filled mailto with the paper's citation; the AsPEN office can forward to the corresponding author who can legally share an individual copy.
- **No fake gating.** Everything visible to a member today is also visible to the public. The only difference is the application flow.

## Phase 2 — flips on at host change

### Architecture

```
                  ┌─────────────────────────────────┐
   Public web ──▶ │   Cloudflare Pages (free)        │
                  │   - static Astro build            │
                  │   - /          public             │
                  │   - /about/    public             │
                  │   - /members/  Cloudflare Access  │ ◀── identity layer
                  └─────────────────────────────────┘
                                ▲
                                │
                  ┌─────────────┴──────────────┐
                  │  Cloudflare Access (free   │
                  │  ≤ 50 users; ≈$3/mo above) │
                  │  - email magic-link or     │
                  │    Google / Microsoft SSO  │
                  │  - allowlist managed in    │
                  │    Cloudflare dashboard    │
                  └────────────────────────────┘
```

**Why Cloudflare Pages + Access**: zero-rewrite migration from GH Pages (same `dist/` output, same Astro build), generous free tier, identity is fully managed (no auth code in our repo), members.json never leaves the Cloudflare dashboard so no risk of accidentally committing membership data to git.

**Alternatives considered & deferred**:
- *Vercel + Auth.js + Postgres* — more flexible (custom UI, finer-grained roles, member directory inside the app) but adds two services to maintain and a database to back up.
- *ISPE SSO* — best UX in principle (AsPEN is an ISPE SIG, members already have ISPE accounts) but contingent on ISPE exposing an OAuth/SAML endpoint. Worth asking, but not blocking.
- *Shared password* — rejected; no per-user revocation, leaks once one member shares it, can't audit who accessed what.

### Migration runbook (when ready)

1. Connect the GitHub repo to Cloudflare Pages → set build command `npm run build`, output `dist`. Single commit, takes ~5 min.
2. Verify the CF Pages preview URL matches the current site exactly.
3. Cut DNS: point `aspensig.asia` (or whatever the canonical URL becomes) at the CF Pages project. GH Pages goes read-only / decommissioned.
4. Enable Cloudflare Access on the application — protect path `/members/*` only. Public routes stay public.
5. Add the chair + A&E office as Access admins in the CF dashboard.
6. Begin onboarding: each approved application becomes an `Add user` entry in the Access dashboard (just an email address).

### Member area scaffolding (build out incrementally after migration)

- `/members/` — landing page with what's inside, last-updated date.
- `/members/papers/` — curated full-text library. Each entry pulls from `publications.json` plus, optionally, a `memberPdf` field pointing at an AsPEN-hosted file in `public/members/papers/`. Only papers where AsPEN has explicit author permission are added.
- `/members/materials/` — study protocols, analysis code (often just links to private GitHub repos), slide decks, working drafts.
- `/members/directory/` — member directory (name, country, affiliation, research interests). Built from a `members.json` file kept out of the public site bundle — see below.
- `/members/changelog/` — what's been added recently, so members have a reason to revisit.

### Data files

- `src/data/members.json` — list of approved members. **Do not bundle into the public site.** Either: (a) load only inside `/members/` pages, which means it never reaches a non-authenticated visitor because CF Access blocks the page before the asset request; or (b) keep it in a separate `members-private/` content directory that the build only includes when `process.env.INCLUDE_MEMBER_DATA === "true"` (set in CF Pages env). Option (a) is simpler.
- Each member record: `{ email, name, affiliation, country, role, joinedDate, status }`. Status `active | invited | removed`. Email matches the address Cloudflare Access uses for SSO.
- `members.json` is also the source of truth for the CF Access allowlist — a small script (`scripts/sync-access-allowlist.js`) can post the active emails to CF's API on each merge, so the admin only edits the JSON via PagesCMS (with the right permissions) and the allowlist follows.

### Application → approval workflow

1. Applicant clicks **Apply** on `/membership/` → email arrives at chair + A&E office.
2. Chair / A&E reviews. If approved:
   - Add a row to `members.json` (PagesCMS or hand-edit), status `invited`.
   - The sync script propagates the email to Cloudflare Access.
   - CF Access sends the welcome email with magic-link instructions.
3. Member logs in once → status moves to `active`. (Tracked manually or via a CF Access webhook for the keen.)
4. Removal: flip `status` to `removed`, the sync script revokes from CF Access on next deploy.

### Open questions for chair to weigh in on

- ISPE SSO — worth asking ISPE if they expose anything? Would simplify onboarding hugely.
- Member directory visibility — public, members-only, opt-in per member? Default proposal: opt-in per member (a flag on each record).
- Should the application form ask for ISPE membership confirmation, or stay agnostic?
- Phase 2 paper library — who curates the AAM uploads? Author-driven (each author sends in copies of their own papers) is the cleanest legally.

## What this means for code in the meantime

- Anything we add to `src/pages/members/*.astro` today gets built into the public site. So **don't put anything member-only into the build yet** — wait until CF Access is in front of it, or use a build-time guard.
- The `fulltext` field already on the publications schema (currently unused) is the right place for author-supplied free-text URLs. Adding entries to it shrinks the "Request from authors" set for everyone, member or not.
- `members.json` doesn't exist yet — don't create it until Phase 2 is being built, to avoid the file ending up in git history with member emails.
