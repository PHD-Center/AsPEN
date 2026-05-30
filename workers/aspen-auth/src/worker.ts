/**
 * AsPEN member-auth Worker.
 *
 * Authentication mechanisms
 *   · Magic-link email (passwordless) — POST /api/request-login → GET /api/verify
 *   · Password login                  — POST /api/login
 *   · Set / change password           — POST /api/set-password (session required)
 *
 * All sign-in routes eventually set the same `aspen_session` HttpOnly
 * cookie (SameSite=None; Secure; 30d) used by every other route.
 *
 * Content
 *   · GET /api/me                         — current member's own record
 *   · GET /api/content/{path}             — proxy file from private repo
 *   · POST /api/logout                    — expire session cookie
 *
 * Backend: PHD-Center/aspen-members private GitHub repo holds
 * members.json (read+write) and papers/, materials/ (read-only proxy).
 *
 * Secrets (set with `wrangler secret put <NAME>`):
 *   GITHUB_PAT       Fine-grained PAT, scoped to MEMBERS_REPO.
 *                    Needs Contents: Read AND Write for password updates.
 *   JWT_SECRET       Random 32+ bytes used to sign JWTs.
 *   RESEND_API_KEY   Resend API key for sending magic-link emails.
 */

export interface Env {
  GITHUB_PAT: string;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  MEMBERS_REPO: string;
  MEMBERS_BRANCH: string;
  SITE_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  SENDER_EMAIL: string;
  SENDER_NAME: string;
  SESSION_DAYS: string;
  MAGIC_LINK_MINUTES: string;
  /** Comma-separated lowercase emails — these accounts can never be
      demoted or removed and are always treated as admin regardless of
      what members.json says. */
  SUPERADMIN_EMAILS: string;
}

function isSuperAdmin(email: string, env: Env): boolean {
  const list = (env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

interface Member {
  email: string;
  name: string;
  affiliation?: string;
  country?: string;
  role?: string;
  status: "active" | "invited" | "removed";
  joinedDate?: string;
  passwordHash?: string;
  /** If true, this member can review pending uploads and approve/reject. */
  admin?: boolean;
}

interface JwtPayload {
  sub: string;       // member email (lowercased)
  purpose: "magic" | "session";
  iat: number;
  exp: number;
}

const SESSION_COOKIE = "aspen_session";

// PBKDF2 cost — 100K SHA-256 iterations. Web Crypto is hardware-accelerated
// so this completes well under the Workers free-tier CPU budget (~10 ms).
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_SALT_BYTES = 16;
const MIN_PASSWORD_LENGTH = 8;

// ─── Main fetch handler ─────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") ?? "";
    const cors = corsHeaders(origin, env);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      let resp: Response;
      if (url.pathname === "/api/request-login" && req.method === "POST") {
        resp = await handleRequestLogin(req, env);
      } else if (url.pathname === "/api/login" && req.method === "POST") {
        resp = await handleLogin(req, env);
      } else if (url.pathname === "/api/verify" && req.method === "GET") {
        resp = await handleVerify(req, env);
      } else if (url.pathname === "/api/me" && req.method === "GET") {
        resp = await handleMe(req, env);
      } else if (url.pathname === "/api/set-password" && req.method === "POST") {
        resp = await handleSetPassword(req, env);
      } else if (url.pathname === "/api/me/update" && req.method === "POST") {
        resp = await handleUpdateOwnProfile(req, env);
      } else if (url.pathname === "/api/logout" && req.method === "POST") {
        resp = handleLogout();
      } else if (url.pathname.startsWith("/api/content/") && req.method === "GET") {
        resp = await handleContent(req, env, url.pathname.slice("/api/content/".length));
      } else if (url.pathname.startsWith("/api/list/") && req.method === "GET") {
        resp = await handleList(req, env, url.pathname.slice("/api/list/".length));
      } else if (url.pathname === "/api/upload" && req.method === "POST") {
        resp = await handleUpload(req, env);
      } else if (url.pathname === "/api/pending" && req.method === "GET") {
        resp = await handlePending(req, env);
      } else if (url.pathname === "/api/review" && req.method === "POST") {
        resp = await handleReview(req, env);
      } else if (url.pathname === "/api/admin/delete-file" && req.method === "POST") {
        resp = await handleAdminDeleteFile(req, env);
      } else if (url.pathname === "/api/request-delete" && req.method === "POST") {
        resp = await handleRequestDelete(req, env);
      } else if (url.pathname === "/api/delete-requests" && req.method === "GET") {
        resp = await handleDeleteRequestsList(req, env);
      } else if (url.pathname === "/api/admin/delete-requests" && req.method === "POST") {
        resp = await handleAdminDeleteRequestAction(req, env);
      } else if (url.pathname === "/api/admin/members" && req.method === "GET") {
        resp = await handleAdminMembersList(req, env);
      } else if (url.pathname === "/api/admin/members" && req.method === "POST") {
        resp = await handleAdminMembersUpsert(req, env);
      } else if (url.pathname === "/api/studies" && req.method === "GET") {
        resp = await handleStudiesList(req, env);
      } else if (url.pathname === "/api/studies/express-interest" && req.method === "POST") {
        resp = await handleStudiesExpressInterest(req, env);
      } else if (url.pathname === "/api/admin/studies" && req.method === "POST") {
        resp = await handleAdminStudies(req, env);
      } else if (url.pathname === "/api/admin/studies/confirm-interest" && req.method === "POST") {
        resp = await handleAdminStudiesConfirmInterest(req, env);
      } else if (url.pathname === "/api/studies/propose" && req.method === "POST") {
        resp = await handleStudiesPropose(req, env);
      } else if (url.pathname === "/api/admin/studies/proposals" && req.method === "GET") {
        resp = await handleAdminStudiesProposals(req, env);
      } else if (url.pathname === "/api/admin/studies/proposals/action" && req.method === "POST") {
        resp = await handleAdminStudiesProposalsAction(req, env);
      } else if (url.pathname === "/" || url.pathname === "") {
        resp = new Response("aspen-auth worker — ok", { status: 200 });
      } else {
        resp = new Response("Not Found", { status: 404 });
      }

      for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
      return resp;
    } catch (err) {
      console.error("worker error", err);
      return new Response("Internal error", { status: 500, headers: cors });
    }
  },
};

// ─── Auth routes ───────────────────────────────────────────────────────

async function handleRequestLogin(req: Request, env: Env): Promise<Response> {
  const body = await safeJson<{ email?: string }>(req);
  const email = (body?.email ?? "").trim().toLowerCase();
  if (!isLikelyEmail(email)) return jsonResponse({ ok: true });

  const { members } = await fetchMembersJson(env);
  const member = members.find((m) => m.email.toLowerCase() === email);

  if (member && (member.status === "active" || member.status === "invited")) {
    const minutes = parseInt(env.MAGIC_LINK_MINUTES, 10) || 15;
    const token = await signJwt(
      { sub: email, purpose: "magic" },
      env.JWT_SECRET,
      minutes * 60,
    );
    const link = `${env.SITE_BASE_URL.replace(/\/$/, "")}/members/verify?t=${encodeURIComponent(token)}`;
    // Swallow Resend errors here — we already mask whether an email exists
    // by always returning ok:true, so masking Resend failures is consistent.
    // Real failures show up in `wrangler tail` for the admin to see.
    try {
      await sendMagicLinkEmail(env, email, member.name, link, minutes);
    } catch (e) {
      console.error("magic-link send failed for", email, e);
    }
  }

  return jsonResponse({ ok: true });
}

async function handleLogin(req: Request, env: Env): Promise<Response> {
  const body = await safeJson<{ email?: string; password?: string }>(req);
  const email = (body?.email ?? "").trim().toLowerCase();
  const password = body?.password ?? "";
  // Generic failure response — never enumerate which check failed.
  const fail = () => jsonResponse({ ok: false, error: "Invalid email or password." }, 401);

  if (!isLikelyEmail(email) || !password) return fail();

  const { members } = await fetchMembersJson(env);
  const member = members.find((m) => m.email.toLowerCase() === email);
  if (!member || member.status !== "active" || !member.passwordHash) return fail();

  const ok = await verifyPassword(password, member.passwordHash);
  if (!ok) return fail();

  return issueSessionResponse(email, env);
}

async function handleVerify(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token) return new Response("Missing token", { status: 400 });

  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || payload.purpose !== "magic") {
    return new Response("Invalid or expired magic link", { status: 401 });
  }

  const days = parseInt(env.SESSION_DAYS, 10) || 30;
  const session = await signJwt(
    { sub: payload.sub, purpose: "session" },
    env.JWT_SECRET,
    days * 24 * 60 * 60,
  );

  // Belt-and-suspenders auth handover:
  //   · Set-Cookie for browsers that accept cross-site cookies
  //   · #t=<jwt> fragment for browsers that don't (iOS Safari etc.)
  // Fragments are NOT sent over the network in subsequent requests, so
  // putting the JWT there is safer than ?t=… (which would land in
  // server logs, Referer headers, history, etc.). The site's
  // BaseLayout grabs the fragment, stores it in localStorage, and
  // strips the URL.
  const target = `${env.SITE_BASE_URL.replace(/\/$/, "")}/members/#t=${encodeURIComponent(session)}`;
  const headers = new Headers({ Location: target });
  headers.set("Set-Cookie", buildSessionCookie(session, days));
  return new Response(null, { status: 302, headers });
}

async function handleMe(req: Request, env: Env): Promise<Response> {
  const email = await sessionEmail(req, env);
  if (!email) return jsonResponse({ ok: false }, 401);

  const { members } = await fetchMembersJson(env);
  const member = members.find((m) => m.email.toLowerCase() === email);
  if (!member || member.status !== "active") return jsonResponse({ ok: false }, 401);

  const superAdmin = isSuperAdmin(member.email, env);
  return jsonResponse({
    ok: true,
    member: {
      email: member.email,
      name: member.name,
      affiliation: member.affiliation,
      country: member.country,
      role: member.role,
      joinedDate: member.joinedDate,
      hasPassword: Boolean(member.passwordHash),
      // Super admins are always admin regardless of the file.
      isAdmin: Boolean(member.admin) || superAdmin,
      isSuperAdmin: superAdmin,
    },
  });
}

async function handleSetPassword(req: Request, env: Env): Promise<Response> {
  const email = await sessionEmail(req, env);
  if (!email) return jsonResponse({ ok: false, error: "Not signed in." }, 401);

  const body = await safeJson<{ currentPassword?: string; newPassword?: string }>(req);
  const newPassword = body?.newPassword ?? "";
  const currentPassword = body?.currentPassword ?? "";

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse({ ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
  }

  const { members, sha } = await fetchMembersJson(env);
  const member = members.find((m) => m.email.toLowerCase() === email);
  if (!member || member.status !== "active") {
    return jsonResponse({ ok: false, error: "Not signed in." }, 401);
  }

  // If a password is already set, require the current one to change it.
  // (First-time set — no current password — is allowed without it; the
  // session itself is the proof of identity, established via magic-link.)
  if (member.passwordHash) {
    if (!currentPassword) {
      return jsonResponse({ ok: false, error: "Enter your current password." }, 400);
    }
    const ok = await verifyPassword(currentPassword, member.passwordHash);
    if (!ok) return jsonResponse({ ok: false, error: "Current password is incorrect." }, 400);
  }

  member.passwordHash = await hashPassword(newPassword);
  await putMembersJson(env, members, sha, `${email}: update passwordHash`);

  return jsonResponse({ ok: true });
}

async function handleUpdateOwnProfile(req: Request, env: Env): Promise<Response> {
  const oldEmail = await sessionEmail(req, env);
  if (!oldEmail) return jsonResponse({ ok: false, error: "Not signed in." }, 401);

  const body = await safeJson<{
    email?: string;
    name?: string;
    affiliation?: string;
    country?: string;
    role?: string;
  }>(req);

  // Detect email change up front; lowercase for lookups, preserve case for display.
  const newEmailRaw = typeof body?.email === "string" ? body.email.trim() : "";
  const newEmailLc  = newEmailRaw.toLowerCase();
  const wantsEmailChange = newEmailLc !== "" && newEmailLc !== oldEmail;

  if (wantsEmailChange) {
    if (!isLikelyEmail(newEmailLc)) {
      return jsonResponse({ ok: false, error: "New email doesn't look valid." }, 400);
    }
    if (isSuperAdmin(oldEmail, env)) {
      return jsonResponse({
        ok: false,
        error: "Super-admin email is pinned in deployment config and can't be changed via self-edit. Ask the deployer to update SUPERADMIN_EMAILS.",
      }, 400);
    }
  }

  const { members, sha } = await fetchMembersJson(env);
  // Check new email isn't taken by another member.
  if (wantsEmailChange && members.some((m) => m.email.toLowerCase() === newEmailLc && m.email.toLowerCase() !== oldEmail)) {
    return jsonResponse({ ok: false, error: "That email is already taken by another member." }, 400);
  }

  const idx = members.findIndex((m) => m.email.toLowerCase() === oldEmail);
  if (idx === -1 || members[idx].status !== "active") {
    return jsonResponse({ ok: false, error: "Not signed in." }, 401);
  }

  const m = members[idx];
  // Members can update these fields about themselves. They CANNOT change
  // their status, admin flag, passwordHash, or joinedDate — those are
  // admin-only. Email change is allowed but cascades through other JSON
  // files (reading / suggestions / delete-requests).
  if (typeof body?.name === "string") {
    const n = body.name.trim();
    if (!n) return jsonResponse({ ok: false, error: "Name can't be empty." }, 400);
    m.name = n.slice(0, 200);
  }
  if (typeof body?.affiliation === "string") {
    m.affiliation = body.affiliation.trim().slice(0, 300) || undefined;
  }
  if (typeof body?.country === "string") {
    m.country = body.country.trim().slice(0, 30) || undefined;
  }
  if (typeof body?.role === "string") {
    m.role = body.role.trim().slice(0, 50) || undefined;
  }
  if (wantsEmailChange) {
    m.email = newEmailRaw;
  }

  members[idx] = m;
  await putMembersJson(env, members, sha,
    `${oldEmail}${wantsEmailChange ? ` → ${newEmailLc}` : ""}: self-update profile`);

  // Cascade email change across other JSON files where it appears as a key
  // or author reference. Each is a separate atomic PUT — best-effort, but
  // logged so the chair can audit via git history if anything goes wrong.
  if (wantsEmailChange) {
    try {
      const { list: studies, sha: studiesSha } = await fetchStudies(env);
      let changed = false;
      for (const s of studies) {
        if (s.lead?.email?.toLowerCase() === oldEmail) { s.lead.email = newEmailLc; changed = true; }
        if (s.createdBy?.toLowerCase() === oldEmail) { s.createdBy = newEmailLc; changed = true; }
        for (const i of s.interested || []) {
          if (i.email?.toLowerCase() === oldEmail) { i.email = newEmailLc; changed = true; }
        }
      }
      if (changed) {
        await putJsonFile(env, "studies.json",
          JSON.stringify(studies, null, 2) + "\n", studiesSha,
          `Email change cascade: ${oldEmail} → ${newEmailLc} (studies.json)`);
      }
    } catch (e) { console.error("cascade studies", e); }

    try {
      const { list: dreqs, sha: dreqsSha } = await fetchDeleteRequests(env);
      let changed = false;
      for (const d of dreqs) {
        if (d.requestedBy?.toLowerCase() === oldEmail) { d.requestedBy = newEmailLc; changed = true; }
      }
      if (changed) {
        await putJsonFile(env, "delete-requests.json",
          JSON.stringify(dreqs, null, 2) + "\n", dreqsSha,
          `Email change cascade: ${oldEmail} → ${newEmailLc} (delete-requests.json)`);
      }
    } catch (e) { console.error("cascade delete-requests", e); }

    // Re-issue session cookie with the new email as sub — otherwise the
    // current cookie's sub no longer matches a member and the user gets
    // bounced to the sign-in page on the very next request.
    const days = parseInt(env.SESSION_DAYS, 10) || 30;
    const session = await signJwt(
      { sub: newEmailLc, purpose: "session" },
      env.JWT_SECRET,
      days * 24 * 60 * 60,
    );
    const headers = new Headers();
    headers.set("Set-Cookie", buildSessionCookie(session, days));
    return jsonResponse({ ok: true, emailChanged: true }, 200, headers);
  }

  return jsonResponse({ ok: true });
}

function handleLogout(): Response {
  const headers = new Headers();
  headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`,
  );
  return jsonResponse({ ok: true }, 200, headers);
}

async function handleList(req: Request, env: Env, prefix: string): Promise<Response> {
  const email = await sessionEmail(req, env);
  if (!email) return jsonResponse({ ok: false }, 401);

  const clean = prefix.replace(/\/+$/, "");
  if (clean.includes("..") || clean.startsWith("/")) {
    return jsonResponse({ ok: false }, 400);
  }
  if (clean !== "papers" && clean !== "materials") {
    return jsonResponse({ ok: false }, 403);
  }

  const { members } = await fetchMembersJson(env);
  const member = members.find((m) => m.email.toLowerCase() === email);
  if (!member || member.status !== "active") return jsonResponse({ ok: false }, 401);

  // Use the recursive git tree endpoint — single call gets every file under the prefix.
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/git/trees/${env.MEMBERS_BRANCH}?recursive=1`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (!r.ok) {
    if (r.status === 404) return jsonResponse({ ok: true, files: [] });
    console.error("git/trees failed", r.status);
    return jsonResponse({ ok: false }, 502);
  }
  const data = await r.json() as { tree: Array<{ path: string; type: string; size?: number }> };
  const files = data.tree
    .filter((it) => it.type === "blob" && it.path.startsWith(clean + "/"))
    .map((it) => ({ path: it.path, size: it.size ?? 0 }));

  return jsonResponse({ ok: true, files });
}

// Soft cap on uploaded file size — keeps us comfortably under the GitHub
// Contents API recommended limit (~50 MB) and Worker memory.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

interface PendingMeta {
  uploader: string;
  uploaderName: string;
  uploadedAt: string;
  originalName: string;
  description?: string;
  /** "papers" or "materials" */
  category: "papers" | "materials";
  /** Subfolder under materials/ (protocols, slides, code, ...) — materials only */
  subfolder?: string;
}

async function handleUpload(req: Request, env: Env): Promise<Response> {
  const email = await sessionEmail(req, env);
  if (!email) return jsonResponse({ ok: false, error: "Not signed in." }, 401);

  const { members } = await fetchMembersJson(env);
  const member = members.find((m) => m.email.toLowerCase() === email);
  if (!member || member.status !== "active") {
    return jsonResponse({ ok: false, error: "Not signed in." }, 401);
  }

  let form: FormData;
  try { form = await req.formData(); }
  catch { return jsonResponse({ ok: false, error: "Bad form data." }, 400); }

  const fileEntry = form.get("file");
  if (!(fileEntry instanceof File)) {
    return jsonResponse({ ok: false, error: "No file." }, 400);
  }
  if (fileEntry.size === 0) {
    return jsonResponse({ ok: false, error: "File is empty." }, 400);
  }
  if (fileEntry.size > MAX_UPLOAD_BYTES) {
    return jsonResponse({
      ok: false,
      error: `File too large (max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB).`,
    }, 413);
  }

  const category = String(form.get("category") || "");
  if (category !== "papers" && category !== "materials") {
    return jsonResponse({ ok: false, error: "Invalid category." }, 400);
  }
  const subfolder = String(form.get("subfolder") || "").trim().toLowerCase();
  if (category === "materials" && subfolder && !/^[a-z0-9-]+$/.test(subfolder)) {
    return jsonResponse({ ok: false, error: "Invalid subfolder name." }, 400);
  }
  const description = String(form.get("description") || "").trim().slice(0, 2000);

  // Sanitise filename — keep extension, strip path, allow letters/digits/dots/dashes/spaces
  const originalName = sanitiseFilename(fileEntry.name || "upload.bin");
  if (!originalName) return jsonResponse({ ok: false, error: "Invalid filename." }, 400);

  // Build unique pending dir: pending/<category>/<iso>-<rand>/
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
  const rand = randSlug(6);
  const dirPath = `pending/${category}/${stamp}-${rand}`;

  // Upload the file
  const bytes = new Uint8Array(await fileEntry.arrayBuffer());
  const fileB64 = base64FromBytes(bytes);
  await putBinaryFile(env, `${dirPath}/${originalName}`, fileB64,
    `Upload pending: ${category}/${originalName} by ${email}`);

  // Upload the meta sidecar
  const meta: PendingMeta = {
    uploader: email,
    uploaderName: member.name,
    uploadedAt: new Date().toISOString(),
    originalName,
    description: description || undefined,
    category: category as PendingMeta["category"],
    subfolder: category === "materials" ? (subfolder || undefined) : undefined,
  };
  const metaB64 = base64FromUtf8(JSON.stringify(meta, null, 2) + "\n");
  await putBinaryFile(env, `${dirPath}/meta.json`, metaB64,
    `Upload pending: meta for ${originalName}`);

  return jsonResponse({ ok: true, pendingId: dirPath });
}

async function handlePending(req: Request, env: Env): Promise<Response> {
  const member = await sessionMember(req, env);
  if (!member) return jsonResponse({ ok: false }, 401);
  if (!member.admin) return jsonResponse({ ok: false, error: "Admin only." }, 403);

  // Walk pending/ tree
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/git/trees/${env.MEMBERS_BRANCH}?recursive=1`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (!r.ok) {
    if (r.status === 404) return jsonResponse({ ok: true, items: [] });
    return jsonResponse({ ok: false }, 502);
  }
  const data = await r.json() as { tree: Array<{ path: string; type: string; size?: number }> };

  // Group blobs by their immediate parent dir under pending/<category>/<id>/
  // Each dir has: meta.json + 1 uploaded file
  const groups: Record<string, { files: { path: string; size: number }[]; metaPath?: string }> = {};
  for (const it of data.tree) {
    if (it.type !== "blob") continue;
    if (!it.path.startsWith("pending/")) continue;
    const m = it.path.match(/^(pending\/(?:papers|materials)\/[^/]+)\/(.+)$/);
    if (!m) continue;
    const dir = m[1];
    const name = m[2];
    (groups[dir] ??= { files: [] });
    if (name === "meta.json") {
      groups[dir].metaPath = it.path;
    } else {
      groups[dir].files.push({ path: it.path, size: it.size ?? 0 });
    }
  }

  // Fetch each meta.json in parallel
  const ids = Object.keys(groups);
  const items = await Promise.all(ids.map(async (id) => {
    let meta: PendingMeta | null = null;
    if (groups[id].metaPath) {
      meta = await fetchJsonFile<PendingMeta>(env, groups[id].metaPath!);
    }
    return {
      id,                            // pending/<category>/<stamp-rand>
      meta,
      files: groups[id].files,
    };
  }));

  // Sort newest first based on the directory name (it starts with an ISO timestamp)
  items.sort((a, b) => (a.id < b.id ? 1 : -1));

  return jsonResponse({ ok: true, items });
}

async function handleReview(req: Request, env: Env): Promise<Response> {
  const member = await sessionMember(req, env);
  if (!member) return jsonResponse({ ok: false }, 401);
  if (!member.admin) return jsonResponse({ ok: false, error: "Admin only." }, 403);

  const body = await safeJson<{ id?: string; action?: string; rename?: string }>(req);
  const id = String(body?.id || "");
  const action = body?.action;
  const rename = (body?.rename || "").trim();

  if (!id.match(/^pending\/(papers|materials)\/[^/]+$/)) {
    return jsonResponse({ ok: false, error: "Invalid id." }, 400);
  }
  if (action !== "approve" && action !== "reject") {
    return jsonResponse({ ok: false, error: "Invalid action." }, 400);
  }

  // List the files in the pending dir via git tree (we already know structure)
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/git/trees/${env.MEMBERS_BRANCH}?recursive=1`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (!r.ok) return jsonResponse({ ok: false, error: "Tree fetch failed." }, 502);
  const tree = (await r.json() as { tree: Array<{ path: string; type: string }> }).tree;

  const pendingPaths = tree.filter((it) => it.type === "blob" && it.path.startsWith(id + "/")).map((it) => it.path);
  if (pendingPaths.length === 0) {
    return jsonResponse({ ok: false, error: "Pending item not found." }, 404);
  }

  // Get meta.json contents to know destination
  const metaPath = pendingPaths.find((p) => p.endsWith("/meta.json"));
  if (!metaPath) return jsonResponse({ ok: false, error: "Missing meta.json." }, 500);
  const meta = await fetchJsonFile<PendingMeta>(env, metaPath);
  if (!meta) return jsonResponse({ ok: false, error: "Meta unreadable." }, 500);

  if (action === "reject") {
    // Delete every file in the pending dir
    for (const p of pendingPaths) {
      const file = await fetchFileWithSha(env, p);
      if (file) await deleteFile(env, p, file.sha, `Reject pending: ${p}`);
    }
    return jsonResponse({ ok: true, action: "rejected" });
  }

  // Approve: copy non-meta files to destination(s), then delete pending
  const filesToCopy = pendingPaths.filter((p) => !p.endsWith("/meta.json"));
  if (filesToCopy.length === 0) {
    return jsonResponse({ ok: false, error: "No files to approve." }, 400);
  }

  const destBase = meta.category === "materials"
    ? (meta.subfolder ? `materials/${meta.subfolder}` : "materials")
    : "papers";

  // Determine destination filename: prefer admin's rename if provided, else originalName
  // (rename only applies when there's a single file in the pending; for multi-file
  // uploads we keep their basenames as-is.)
  const destinations: Array<{ src: string; dst: string }> = [];
  for (const src of filesToCopy) {
    const srcBasename = src.split("/").pop()!;
    let dstName = srcBasename;
    if (filesToCopy.length === 1 && rename) {
      dstName = sanitiseFilename(rename) || srcBasename;
    }
    destinations.push({ src, dst: `${destBase}/${dstName}` });
  }

  // Refuse if any destination already exists
  for (const { dst } of destinations) {
    const exists = await fetchFileWithSha(env, dst);
    if (exists) {
      return jsonResponse({
        ok: false,
        error: `Destination already exists: ${dst}. Reject this submission, or add a rename to overwrite is not supported yet.`,
      }, 409);
    }
  }

  // Copy each file: GET content from src, PUT to dst
  for (const { src, dst } of destinations) {
    const f = await fetchFileWithSha(env, src);
    if (!f) return jsonResponse({ ok: false, error: `Source missing: ${src}` }, 500);
    await putBinaryFile(env, dst, f.contentB64.replace(/\n/g, ""),
      `Approve: ${dst} (from ${meta.uploader})`);
  }

  // Delete all pending files (file + meta)
  for (const p of pendingPaths) {
    const f = await fetchFileWithSha(env, p);
    if (f) await deleteFile(env, p, f.sha, `Cleanup pending: ${p}`);
  }

  return jsonResponse({ ok: true, action: "approved", destinations: destinations.map((d) => d.dst) });
}


// ── Active Studies Tracker ─────────────────────────────────────────────
//
// studies.json holds a flat list of multi-country AsPEN studies the chair
// (and other admins) want to surface in /members/studies. Each study lives
// in one of 7 stages and can collect "express interest" entries from any
// signed-in member; the chair confirms an interest by moving the member's
// site into the study's confirmed `sites[]` list.

const STUDY_STAGES = [
  "concept", "protocol", "site-irb", "extraction", "analysis", "drafting", "published",
] as const;
type StudyStage = (typeof STUDY_STAGES)[number];
const STUDY_DESIGNS = ["ACNU", "SCCS", "CCO", "Other"] as const;
type StudyDesign = (typeof STUDY_DESIGNS)[number];

interface StudyMilestone {
  date: string;
  note: string;
}
interface StudyInterest {
  email: string;
  name: string;
  site: string;      // site id, e.g. "TW-NHIRD"
  note: string;
  expressedAt: string;
}
interface Study {
  slug: string;
  title: string;
  design: StudyDesign;
  stage: StudyStage;
  lead: { name: string; email: string };
  description: string;
  /** Confirmed participating sites (chair-confirmed, ids like "TW-NHIRD"). */
  sites: string[];
  /** Sites the chair would still like to recruit. */
  sitesWanted: string[];
  /** Optional path inside papers/ to the protocol PDF. */
  protocolUrl?: string;
  /** Optional published-paper PMID. */
  pmid?: string;
  milestones: StudyMilestone[];
  interested: StudyInterest[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

async function fetchStudies(env: Env): Promise<{ list: Study[]; sha: string }> {
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/studies.json?ref=${env.MEMBERS_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (!r.ok) {
    if (r.status === 404) return { list: [], sha: "" };
    throw new Error(`fetchStudies ${r.status}`);
  }
  const data = await r.json() as { content: string; sha: string };
  const text = utf8FromBase64(data.content.replace(/\s+/g, ""));
  let list: Study[] = [];
  try { list = JSON.parse(text); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  return { list, sha: data.sha };
}

function makeSlug(title: string): string {
  return (title || "study")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "study";
}

async function handleStudiesList(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);
  const { list } = await fetchStudies(env);
  return jsonResponse({ ok: true, studies: list, stages: STUDY_STAGES });
}

async function handleStudiesExpressInterest(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);
  const body = await safeJson<{ slug?: string; site?: string; note?: string }>(req);
  const slug = String(body?.slug || "").trim();
  const site = String(body?.site || "").trim().slice(0, 80);
  const note = String(body?.note || "").trim().slice(0, 1000);
  if (!slug || !site) return jsonResponse({ ok: false, error: "Missing fields." }, 400);

  const { list, sha } = await fetchStudies(env);
  const study = list.find((s) => s.slug === slug);
  if (!study) return jsonResponse({ ok: false, error: "Study not found." }, 404);

  const email = m.email.toLowerCase();
  study.interested ??= [];
  // Dedupe by email + site
  const already = study.interested.find((i) => i.email.toLowerCase() === email && i.site === site);
  if (already) {
    already.note = note;
    already.expressedAt = new Date().toISOString();
  } else {
    study.interested.unshift({
      email,
      name: m.name,
      site,
      note,
      expressedAt: new Date().toISOString(),
    });
  }
  study.updatedAt = new Date().toISOString();
  await putJsonFile(env, "studies.json",
    JSON.stringify(list, null, 2) + "\n", sha,
    `Study ${slug}: interest from ${email} (${site})`);

  // Notify chair — swallow errors to keep UX consistent with magic-link.
  try {
    await sendStudyInterestEmail(env, study, m.name, email, site, note);
  } catch (e) {
    console.error("study interest email failed", e);
  }

  return jsonResponse({ ok: true });
}

async function handleAdminStudies(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);
  if (!m.admin) return jsonResponse({ ok: false, error: "Admin only." }, 403);

  const body = await safeJson<{
    action?: string;
    slug?: string;
    payload?: Partial<Study> & { stage?: string };
  }>(req);
  const action = body?.action;
  const slug = String(body?.slug || "").trim();
  if (action !== "create" && action !== "update" && action !== "delete" && action !== "move-stage") {
    return jsonResponse({ ok: false, error: "Invalid action." }, 400);
  }

  const { list, sha } = await fetchStudies(env);
  const now = new Date().toISOString();
  let commitMsg = "";

  if (action === "create") {
    const p = body?.payload || {};
    const title = String(p.title || "").trim().slice(0, 300);
    if (!title) return jsonResponse({ ok: false, error: "Title required." }, 400);
    const newSlug = slug ? makeSlug(slug) : makeSlug(title);
    if (list.some((s) => s.slug === newSlug)) {
      return jsonResponse({ ok: false, error: "A study with that slug already exists." }, 409);
    }
    const study: Study = {
      slug: newSlug,
      title,
      design: (STUDY_DESIGNS.includes(p.design as StudyDesign) ? p.design : "Other") as StudyDesign,
      stage: (STUDY_STAGES.includes(p.stage as StudyStage) ? p.stage : "concept") as StudyStage,
      lead: {
        name: String(p.lead?.name || "").slice(0, 120),
        email: String(p.lead?.email || "").slice(0, 200),
      },
      description: String(p.description || "").slice(0, 3000),
      sites: Array.isArray(p.sites) ? p.sites.map(String).slice(0, 50) : [],
      sitesWanted: Array.isArray(p.sitesWanted) ? p.sitesWanted.map(String).slice(0, 50) : [],
      protocolUrl: p.protocolUrl ? String(p.protocolUrl).slice(0, 300) : undefined,
      pmid: p.pmid ? String(p.pmid).slice(0, 20) : undefined,
      milestones: Array.isArray(p.milestones) ? p.milestones.slice(0, 50) : [],
      interested: [],
      createdAt: now,
      createdBy: m.email.toLowerCase(),
      updatedAt: now,
    };
    list.unshift(study);
    commitMsg = `Study ${newSlug}: create by ${m.email}`;
  } else if (action === "delete") {
    const idx = list.findIndex((s) => s.slug === slug);
    if (idx < 0) return jsonResponse({ ok: false, error: "Study not found." }, 404);
    list.splice(idx, 1);
    commitMsg = `Study ${slug}: delete by ${m.email}`;
  } else if (action === "move-stage") {
    const study = list.find((s) => s.slug === slug);
    if (!study) return jsonResponse({ ok: false, error: "Study not found." }, 404);
    const newStage = String(body?.payload?.stage || "") as StudyStage;
    if (!STUDY_STAGES.includes(newStage)) {
      return jsonResponse({ ok: false, error: "Invalid stage." }, 400);
    }
    study.stage = newStage;
    study.updatedAt = now;
    commitMsg = `Study ${slug}: stage → ${newStage} by ${m.email}`;
  } else {
    // update
    const study = list.find((s) => s.slug === slug);
    if (!study) return jsonResponse({ ok: false, error: "Study not found." }, 404);
    const p = body?.payload || {};
    if (p.title !== undefined) study.title = String(p.title).slice(0, 300);
    if (p.design !== undefined && STUDY_DESIGNS.includes(p.design as StudyDesign)) study.design = p.design as StudyDesign;
    if (p.stage !== undefined && STUDY_STAGES.includes(p.stage as StudyStage)) study.stage = p.stage as StudyStage;
    if (p.lead !== undefined) study.lead = {
      name: String(p.lead?.name || "").slice(0, 120),
      email: String(p.lead?.email || "").slice(0, 200),
    };
    if (p.description !== undefined) study.description = String(p.description).slice(0, 3000);
    if (Array.isArray(p.sites)) study.sites = p.sites.map(String).slice(0, 50);
    if (Array.isArray(p.sitesWanted)) study.sitesWanted = p.sitesWanted.map(String).slice(0, 50);
    if (p.protocolUrl !== undefined) study.protocolUrl = p.protocolUrl ? String(p.protocolUrl).slice(0, 300) : undefined;
    if (p.pmid !== undefined) study.pmid = p.pmid ? String(p.pmid).slice(0, 20) : undefined;
    if (Array.isArray(p.milestones)) study.milestones = p.milestones.slice(0, 50);
    study.updatedAt = now;
    commitMsg = `Study ${slug}: update by ${m.email}`;
  }

  await putJsonFile(env, "studies.json",
    JSON.stringify(list, null, 2) + "\n", sha, commitMsg);
  return jsonResponse({ ok: true });
}

async function handleAdminStudiesConfirmInterest(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);
  if (!m.admin) return jsonResponse({ ok: false, error: "Admin only." }, 403);

  const body = await safeJson<{
    slug?: string;
    interestedEmail?: string;
    site?: string;
    action?: "confirm" | "reject";
  }>(req);
  const slug = String(body?.slug || "").trim();
  const interestedEmail = String(body?.interestedEmail || "").toLowerCase();
  const site = String(body?.site || "").trim();
  const action = body?.action === "reject" ? "reject" : "confirm";
  if (!slug || !interestedEmail || !site) {
    return jsonResponse({ ok: false, error: "Missing fields." }, 400);
  }

  const { list, sha } = await fetchStudies(env);
  const study = list.find((s) => s.slug === slug);
  if (!study) return jsonResponse({ ok: false, error: "Study not found." }, 404);

  study.interested ??= [];
  const idx = study.interested.findIndex((i) => i.email.toLowerCase() === interestedEmail && i.site === site);
  if (idx < 0) return jsonResponse({ ok: false, error: "Interest not found." }, 404);
  study.interested.splice(idx, 1);

  if (action === "confirm") {
    study.sites ??= [];
    if (!study.sites.includes(site)) study.sites.push(site);
    // Also remove from sitesWanted if it was being recruited.
    study.sitesWanted = (study.sitesWanted || []).filter((s) => s !== site);
  }
  study.updatedAt = new Date().toISOString();

  await putJsonFile(env, "studies.json",
    JSON.stringify(list, null, 2) + "\n", sha,
    `Study ${slug}: ${action} interest from ${interestedEmail} (${site}) by ${m.email}`);
  return jsonResponse({ ok: true });
}

async function sendStudyInterestEmail(
  env: Env,
  study: Study,
  name: string,
  email: string,
  site: string,
  note: string,
): Promise<void> {
  const fromHeader = env.SENDER_NAME
    ? `${env.SENDER_NAME} <${env.SENDER_EMAIL}>`
    : env.SENDER_EMAIL;
  const chairEmail = study.lead?.email || "";
  if (!chairEmail) return;

  const subject = `[AsPEN study] ${name} wants to join: ${study.title}`;
  const text = [
    `${name} (${email}) has expressed interest in joining the AsPEN study:`,
    "",
    `  ${study.title}`,
    `  Stage: ${study.stage}`,
    `  Proposed site: ${site}`,
    "",
    note ? `Note from ${name}:` : "",
    note ? `  ${note}` : "",
    "",
    `Confirm or reject in the AsPEN admin:`,
    `  ${env.SITE_BASE_URL.replace(/\/$/, "")}/members/admin`,
    "",
    "— AsPEN",
  ].filter(Boolean).join("\n");
  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;max-width:520px;margin:0 auto;padding:24px;">
  <p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) wants to join an AsPEN study.</p>
  <table style="border-collapse:collapse;font-size:14px;">
    <tr><td style="color:#64748b;padding:4px 12px 4px 0;">Study</td><td><strong>${escapeHtml(study.title)}</strong></td></tr>
    <tr><td style="color:#64748b;padding:4px 12px 4px 0;">Stage</td><td>${escapeHtml(study.stage)}</td></tr>
    <tr><td style="color:#64748b;padding:4px 12px 4px 0;">Proposed site</td><td>${escapeHtml(site)}</td></tr>
  </table>
  ${note ? `<p style="margin-top:16px;"><em>${escapeHtml(note)}</em></p>` : ""}
  <p style="margin:24px 0;">
    <a href="${escapeAttr(env.SITE_BASE_URL.replace(/\/$/, "") + "/members/admin")}"
       style="display:inline-block;background:#21443e;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">
      Open the AsPEN admin
    </a>
  </p>
  <p style="font-size:12px;color:#64748b;">— AsPEN</p>
</body></html>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromHeader,
      to: chairEmail,
      subject,
      text,
      html,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`resend study-interest ${r.status} ${body}`);
  }
}

// ── Study proposals (members propose studies for chair to accept) ───────
//
// Proposals are stored separately from studies.json so the public Kanban
// only shows chair-approved studies. Chair sees proposals in admin and
// can Promote → pre-fills the New Study form → Create publishes it.

interface StudyProposal {
  id: string;
  title: string;
  design: StudyDesign;
  leadCandidate: { name: string; email: string };
  description: string;
  sitesWanted: string[];
  reason: string;
  proposedBy: string;
  proposedByName: string;
  proposedAt: string;
  status: "open" | "promoted" | "dismissed";
  /** Set when promoted to point at the resulting study slug. */
  resolvedSlug?: string;
}

async function fetchProposals(env: Env): Promise<{ list: StudyProposal[]; sha: string }> {
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/study-proposals.json?ref=${env.MEMBERS_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (!r.ok) {
    if (r.status === 404) return { list: [], sha: "" };
    throw new Error(`fetchProposals ${r.status}`);
  }
  const data = await r.json() as { content: string; sha: string };
  const text = utf8FromBase64(data.content.replace(/\s+/g, ""));
  let list: StudyProposal[] = [];
  try { list = JSON.parse(text); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  return { list, sha: data.sha };
}

async function handleStudiesPropose(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);
  const body = await safeJson<{
    title?: string;
    design?: string;
    leadName?: string;
    leadEmail?: string;
    description?: string;
    sitesWanted?: string[];
    reason?: string;
  }>(req);
  const title = String(body?.title || "").trim().slice(0, 300);
  const design = (STUDY_DESIGNS.includes(body?.design as StudyDesign) ? body?.design : "Other") as StudyDesign;
  const leadName  = String(body?.leadName  || "").trim().slice(0, 120);
  const leadEmail = String(body?.leadEmail || "").trim().slice(0, 200);
  const description = String(body?.description || "").trim().slice(0, 3000);
  const sitesWanted = Array.isArray(body?.sitesWanted) ? body!.sitesWanted!.map(String).slice(0, 50) : [];
  const reason = String(body?.reason || "").trim().slice(0, 2000);
  if (!title)  return jsonResponse({ ok: false, error: "Title required." }, 400);
  if (!reason) return jsonResponse({ ok: false, error: "Tell us why this study matters." }, 400);

  const { list, sha } = await fetchProposals(env);
  // Soft-dedupe: same proposer + same title (case-insensitive) + open → ignore
  const already = list.find((p) =>
    p.status === "open" &&
    p.proposedBy.toLowerCase() === m.email.toLowerCase() &&
    p.title.toLowerCase() === title.toLowerCase()
  );
  if (already) return jsonResponse({ ok: true, deduped: true, id: already.id });

  const id = "p" + randSlug(10);
  list.unshift({
    id,
    title,
    design,
    leadCandidate: { name: leadName, email: leadEmail },
    description,
    sitesWanted,
    reason,
    proposedBy: m.email.toLowerCase(),
    proposedByName: m.name,
    proposedAt: new Date().toISOString(),
    status: "open",
  });
  await putJsonFile(env, "study-proposals.json",
    JSON.stringify(list, null, 2) + "\n", sha,
    `Study proposal: ${title.slice(0, 80)} by ${m.email}`);

  // Notify chair (best-effort, swallow errors).
  try {
    await sendStudyProposalEmail(env, list[0]);
  } catch (e) {
    console.error("study proposal email failed", e);
  }

  return jsonResponse({ ok: true, id });
}

async function handleAdminStudiesProposals(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);
  if (!m.admin) return jsonResponse({ ok: false, error: "Admin only." }, 403);
  const { list } = await fetchProposals(env);
  return jsonResponse({ ok: true, proposals: list });
}

async function handleAdminStudiesProposalsAction(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);
  if (!m.admin) return jsonResponse({ ok: false, error: "Admin only." }, 403);
  const body = await safeJson<{ id?: string; action?: "promote" | "dismiss"; resolvedSlug?: string }>(req);
  const id = String(body?.id || "");
  const action = body?.action;
  const resolvedSlug = String(body?.resolvedSlug || "").trim();
  if (!id || (action !== "promote" && action !== "dismiss")) {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }
  const { list, sha } = await fetchProposals(env);
  const target = list.find((p) => p.id === id && p.status === "open");
  if (!target) return jsonResponse({ ok: false, error: "Proposal not found." }, 404);
  target.status = action === "promote" ? "promoted" : "dismissed";
  if (action === "promote" && resolvedSlug) target.resolvedSlug = resolvedSlug;
  await putJsonFile(env, "study-proposals.json",
    JSON.stringify(list, null, 2) + "\n", sha,
    `Study proposal ${id}: ${action} by ${m.email}`);
  return jsonResponse({ ok: true });
}

async function sendStudyProposalEmail(env: Env, prop: StudyProposal): Promise<void> {
  const fromHeader = env.SENDER_NAME
    ? `${env.SENDER_NAME} <${env.SENDER_EMAIL}>`
    : env.SENDER_EMAIL;
  const chairEmail = (env.SUPERADMIN_EMAILS || "").split(",")[0]?.trim();
  if (!chairEmail) return;
  const subject = `[AsPEN study proposal] ${prop.proposedByName}: ${prop.title}`;
  const text = [
    `${prop.proposedByName} (${prop.proposedBy}) has proposed a new AsPEN study:`,
    "",
    `  ${prop.title}`,
    `  Design: ${prop.design}`,
    `  Proposed lead: ${prop.leadCandidate.name || "(unspecified)"}${prop.leadCandidate.email ? " <" + prop.leadCandidate.email + ">" : ""}`,
    prop.sitesWanted.length ? `  Sites wanted: ${prop.sitesWanted.join(", ")}` : "",
    "",
    `Description:`,
    `  ${prop.description || "(none given)"}`,
    "",
    `Reason:`,
    `  ${prop.reason}`,
    "",
    `Review or promote in the AsPEN admin:`,
    `  ${env.SITE_BASE_URL.replace(/\/$/, "")}/members/admin`,
    "",
    "— AsPEN",
  ].filter(Boolean).join("\n");
  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;max-width:560px;margin:0 auto;padding:24px;">
  <p><strong>${escapeHtml(prop.proposedByName)}</strong> (${escapeHtml(prop.proposedBy)}) has proposed a new AsPEN study.</p>
  <table style="border-collapse:collapse;font-size:14px;margin-top:8px;">
    <tr><td style="color:#64748b;padding:4px 12px 4px 0;">Title</td><td><strong>${escapeHtml(prop.title)}</strong></td></tr>
    <tr><td style="color:#64748b;padding:4px 12px 4px 0;">Design</td><td>${escapeHtml(prop.design)}</td></tr>
    <tr><td style="color:#64748b;padding:4px 12px 4px 0;">Lead candidate</td><td>${escapeHtml(prop.leadCandidate.name || "—")}${prop.leadCandidate.email ? ` &lt;${escapeHtml(prop.leadCandidate.email)}&gt;` : ""}</td></tr>
    ${prop.sitesWanted.length ? `<tr><td style="color:#64748b;padding:4px 12px 4px 0;">Sites wanted</td><td>${escapeHtml(prop.sitesWanted.join(", "))}</td></tr>` : ""}
  </table>
  ${prop.description ? `<p style="margin-top:16px;"><strong>Description:</strong></p><p style="white-space:pre-line;">${escapeHtml(prop.description)}</p>` : ""}
  <p style="margin-top:16px;"><strong>Reason:</strong></p>
  <p style="white-space:pre-line;">${escapeHtml(prop.reason)}</p>
  <p style="margin:24px 0;">
    <a href="${escapeAttr(env.SITE_BASE_URL.replace(/\/$/, "") + "/members/admin")}"
       style="display:inline-block;background:#21443e;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">
      Open the AsPEN admin
    </a>
  </p>
  <p style="font-size:12px;color:#64748b;">— AsPEN</p>
</body></html>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromHeader, to: chairEmail, subject, text, html }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`resend study-proposal ${r.status} ${body}`);
  }
}

// ── File delete + delete-requests ──────────────────────────────────────

interface DeleteRequest {
  path: string;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  status: "open" | "approved" | "dismissed";
}

/** Defence-in-depth: only allow deleting files under materials/ or papers/. */
function isDeletablePath(path: string): boolean {
  if (!path || path.includes("..") || path.startsWith("/")) return false;
  return path.startsWith("materials/") || path.startsWith("papers/");
}

async function handleAdminDeleteFile(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);
  if (!m.admin) return jsonResponse({ ok: false, error: "Admin only." }, 403);

  const body = await safeJson<{ path?: string }>(req);
  const path = String(body?.path || "").trim();
  if (!isDeletablePath(path)) return jsonResponse({ ok: false, error: "Invalid path." }, 400);

  const file = await fetchFileWithSha(env, path);
  if (!file) return jsonResponse({ ok: false, error: "File not found." }, 404);

  await deleteFile(env, path, file.sha, `Admin ${m.email}: delete ${path}`);
  return jsonResponse({ ok: true });
}

async function handleRequestDelete(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);

  const body = await safeJson<{ path?: string; reason?: string }>(req);
  const path = String(body?.path || "").trim();
  const reason = String(body?.reason || "").trim().slice(0, 1500);
  if (!isDeletablePath(path)) return jsonResponse({ ok: false, error: "Invalid path." }, 400);
  if (!reason) return jsonResponse({ ok: false, error: "Please give a reason." }, 400);

  const { list, sha } = await fetchDeleteRequests(env);
  // Dedupe: same email + path + open → no-op
  const already = list.find((d) =>
    d.path === path && d.requestedBy.toLowerCase() === m.email.toLowerCase() && d.status === "open"
  );
  if (already) return jsonResponse({ ok: true, deduped: true });

  list.unshift({
    path,
    reason,
    requestedBy: m.email.toLowerCase(),
    requestedByName: m.name,
    requestedAt: new Date().toISOString(),
    status: "open",
  });
  await putJsonFile(env, "delete-requests.json",
    JSON.stringify(list, null, 2) + "\n", sha,
    `Delete request: ${path} by ${m.email}`);
  return jsonResponse({ ok: true });
}

async function handleDeleteRequestsList(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);
  if (!m.admin) return jsonResponse({ ok: false, error: "Admin only." }, 403);
  const { list } = await fetchDeleteRequests(env);
  return jsonResponse({ ok: true, requests: list });
}

async function handleAdminDeleteRequestAction(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);
  if (!m.admin) return jsonResponse({ ok: false, error: "Admin only." }, 403);

  const body = await safeJson<{ path?: string; requestedAt?: string; action?: "approve" | "dismiss" }>(req);
  const path = String(body?.path || "");
  const requestedAt = String(body?.requestedAt || "");
  const action = body?.action;
  if (!path || !requestedAt || (action !== "approve" && action !== "dismiss")) {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  const { list, sha } = await fetchDeleteRequests(env);
  // Match on path + requestedAt + open (timestamp disambiguates if same path requested twice)
  const target = list.find((d) => d.path === path && d.requestedAt === requestedAt && d.status === "open");
  if (!target) return jsonResponse({ ok: false, error: "Request not found." }, 404);

  if (action === "approve") {
    // Try to delete the file (may already be gone — that's still OK)
    const file = await fetchFileWithSha(env, path);
    if (file) {
      try {
        await deleteFile(env, path, file.sha,
          `Admin ${m.email}: approve delete request for ${path}`);
      } catch (e) {
        return jsonResponse({ ok: false, error: "File delete failed: " + String(e) }, 502);
      }
    }
    target.status = "approved";
  } else {
    target.status = "dismissed";
  }

  // Re-fetch SHA in case the previous file delete touched the tree (it doesn't
  // touch delete-requests.json but be safe)
  const fresh = await fetchDeleteRequests(env);
  // Update the matching entry in fresh.list as well, in case there were any
  // concurrent changes
  const freshTarget = fresh.list.find((d) =>
    d.path === path && d.requestedAt === requestedAt && d.status === "open"
  );
  if (freshTarget) freshTarget.status = target.status;
  await putJsonFile(env, "delete-requests.json",
    JSON.stringify(fresh.list, null, 2) + "\n", fresh.sha,
    `Delete request ${action}: ${path} by ${m.email}`);

  return jsonResponse({ ok: true });
}

async function fetchDeleteRequests(env: Env): Promise<{ list: DeleteRequest[]; sha: string }> {
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/delete-requests.json?ref=${env.MEMBERS_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (!r.ok) {
    if (r.status === 404) return { list: [], sha: "" };
    throw new Error(`fetchDeleteRequests ${r.status}`);
  }
  const data = await r.json() as { content: string; sha: string };
  const text = utf8FromBase64(data.content.replace(/\s+/g, ""));
  let list: DeleteRequest[] = [];
  try { list = JSON.parse(text); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  return { list, sha: data.sha };
}

// Generalised JSON-file PUT (used by studies.json, etc.; members.json has its own).
async function putJsonFile(
  env: Env,
  path: string,
  content: string,
  sha: string,
  message: string,
): Promise<void> {
  const contentB64 = base64FromUtf8(content);
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/${path}`;
  const body: Record<string, unknown> = {
    message,
    content: contentB64,
    branch: env.MEMBERS_BRANCH,
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("putJsonFile failed", r.status, txt);
    throw new Error(`putJsonFile ${r.status}`);
  }
}

// ── Admin: member CRUD ─────────────────────────────────────────────────

async function handleAdminMembersList(req: Request, env: Env): Promise<Response> {
  const m = await sessionMember(req, env);
  if (!m) return jsonResponse({ ok: false }, 401);
  if (!m.admin) return jsonResponse({ ok: false, error: "Admin only." }, 403);
  const { members } = await fetchMembersJson(env);
  return jsonResponse({
    ok: true,
    members: members.map((mem) => {
      const { passwordHash, ...rest } = mem;
      const sa = isSuperAdmin(mem.email, env);
      return {
        ...rest,
        hasPassword: Boolean(passwordHash),
        superAdmin: sa,
        // Super admins are always admin in the UI even if the file doesn't say so.
        admin: Boolean(mem.admin) || sa,
      };
    }),
  });
}

async function handleAdminMembersUpsert(req: Request, env: Env): Promise<Response> {
  const acting = await sessionMember(req, env);
  if (!acting) return jsonResponse({ ok: false }, 401);
  if (!acting.admin) return jsonResponse({ ok: false, error: "Admin only." }, 403);

  const body = await safeJson<{
    email?: string;
    name?: string;
    affiliation?: string;
    country?: string;
    role?: string;
    status?: Member["status"];
    admin?: boolean;
  }>(req);

  const email = String(body?.email || "").trim().toLowerCase();
  if (!isLikelyEmail(email)) return jsonResponse({ ok: false, error: "Invalid email." }, 400);

  const { members, sha } = await fetchMembersJson(env);
  const existing = members.find((m) => m.email.toLowerCase() === email);

  const status: Member["status"] =
    body?.status === "active" || body?.status === "invited" || body?.status === "removed"
      ? body.status
      : existing?.status ?? "invited";

  const next: Member = existing ?? {
    email,
    name: "",
    status,
    joinedDate: new Date().toISOString().slice(0, 10),
  };

  // Patch fields if provided. Always allow status/admin to be cleared by sending the keys explicitly.
  if (typeof body?.name === "string")        next.name = body.name.trim();
  if (typeof body?.affiliation === "string") next.affiliation = body.affiliation.trim() || undefined;
  if (typeof body?.country === "string")     next.country = body.country.trim() || undefined;
  if (typeof body?.role === "string")        next.role = body.role.trim() || undefined;
  next.status = status;
  if (typeof body?.admin === "boolean")      next.admin = body.admin || undefined;

  // Super-admin safety rails — these accounts can never be demoted or removed.
  if (isSuperAdmin(email, env)) {
    next.admin = true;
    if (next.status === "removed") {
      return jsonResponse({ ok: false, error: "Can't remove a super admin." }, 400);
    }
  }

  // Self-demotion safety rail (anyone, not just super admins)
  if (email === acting.email.toLowerCase() && !next.admin) {
    return jsonResponse({ ok: false, error: "You can't remove your own admin flag." }, 400);
  }

  if (!next.name) {
    return jsonResponse({ ok: false, error: "Name required for new members." }, 400);
  }

  // Replace or append
  if (existing) {
    const idx = members.findIndex((m) => m.email.toLowerCase() === email);
    members[idx] = next;
  } else {
    members.push(next);
  }

  await putMembersJson(env, members, sha,
    `Admin ${acting.email}: ${existing ? "update" : "add"} ${email}`);

  return jsonResponse({ ok: true, member: { ...next, hasPassword: Boolean(next.passwordHash) } });
}

// ── Helpers used by the new routes ─────────────────────────────────────

async function sessionMember(req: Request, env: Env): Promise<Member | null> {
  const email = await sessionEmail(req, env);
  if (!email) return null;
  const { members } = await fetchMembersJson(env);
  const m = members.find((m) => m.email.toLowerCase() === email);
  if (!m || m.status !== "active") return null;
  // Force admin=true for super admins (defence-in-depth — even if members.json
  // was edited to demote them, the worker still treats them as admin).
  if (isSuperAdmin(m.email, env)) {
    return { ...m, admin: true };
  }
  return m;
}

async function fetchJsonFile<T>(env: Env, path: string): Promise<T | null> {
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/${path}?ref=${env.MEMBERS_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github.raw",
    },
  });
  if (!r.ok) return null;
  try { return await r.json() as T; } catch { return null; }
}

interface BlobWithSha {
  sha: string;
  contentB64: string;
}

async function fetchFileWithSha(env: Env, path: string): Promise<BlobWithSha | null> {
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/${path}?ref=${env.MEMBERS_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (!r.ok) return null;
  const data = await r.json() as { sha: string; content: string; encoding?: string };
  return { sha: data.sha, contentB64: data.content };
}

async function putBinaryFile(env: Env, path: string, contentB64: string, message: string): Promise<void> {
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/${path}`;
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, content: contentB64, branch: env.MEMBERS_BRANCH }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.error("putBinaryFile failed", r.status, body);
    throw new Error(`putBinaryFile ${r.status}`);
  }
}

async function deleteFile(env: Env, path: string, sha: string, message: string): Promise<void> {
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/${path}`;
  const r = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, sha, branch: env.MEMBERS_BRANCH }),
  });
  if (!r.ok) {
    console.error("deleteFile failed", r.status);
    throw new Error(`deleteFile ${r.status}`);
  }
}

function base64FromBytes(bytes: Uint8Array): string {
  // Chunked to avoid blowing the JS call-stack on large files.
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

function sanitiseFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() || "";
  // Keep alphanumerics, dot, dash, underscore, space — replace rest with underscore.
  // Collapse repeats. Trim leading dots.
  return base
    .replace(/[^a-zA-Z0-9._\- ]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 200);
}

function randSlug(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += "abcdefghijklmnopqrstuvwxyz0123456789"[bytes[i] % 36];
  return out;
}

async function handleContent(req: Request, env: Env, path: string): Promise<Response> {
  const email = await sessionEmail(req, env);
  if (!email) return new Response("Unauthorized", { status: 401 });

  if (path.includes("..") || path.startsWith("/")) return new Response("Bad request", { status: 400 });
  if (!path.startsWith("papers/") && !path.startsWith("materials/")) {
    return new Response("Forbidden", { status: 403 });
  }

  const { members } = await fetchMembersJson(env);
  const member = members.find((m) => m.email.toLowerCase() === email);
  if (!member || member.status !== "active") return new Response("Unauthorized", { status: 401 });

  return fetchMemberFile(env, path);
}

// Shared: issue a session for a logged-in email. Returns both:
//   · Set-Cookie  — for cookie-friendly browsers
//   · token in JSON body — so the site can ALSO stash it in
//                          localStorage and send as Authorization: Bearer
//                          (needed on iOS Safari and any browser that
//                          blocks third-party cookies).
async function issueSessionResponse(email: string, env: Env): Promise<Response> {
  const days = parseInt(env.SESSION_DAYS, 10) || 30;
  const session = await signJwt(
    { sub: email, purpose: "session" },
    env.JWT_SECRET,
    days * 24 * 60 * 60,
  );
  const headers = new Headers();
  headers.set("Set-Cookie", buildSessionCookie(session, days));
  return jsonResponse({ ok: true, token: session }, 200, headers);
}

// ─── GitHub API ────────────────────────────────────────────────────────

interface MembersFile {
  members: Member[];
  /** Blob SHA, needed for atomic PUT to avoid clobbering concurrent edits. */
  sha: string;
}

async function fetchMembersJson(env: Env): Promise<MembersFile> {
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/members.json?ref=${env.MEMBERS_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (!r.ok) {
    console.error("fetchMembersJson failed", r.status);
    if (r.status === 404) return { members: [], sha: "" };
    throw new Error(`fetchMembersJson ${r.status}`);
  }
  const data = await r.json() as { content: string; sha: string };
  const text = utf8FromBase64(data.content.replace(/\s+/g, ""));
  let members: Member[] = [];
  try { members = JSON.parse(text); } catch { members = []; }
  if (!Array.isArray(members)) members = [];
  return { members, sha: data.sha };
}

async function putMembersJson(env: Env, members: Member[], sha: string, message: string): Promise<void> {
  const content = JSON.stringify(members, null, 2) + "\n";
  const contentB64 = base64FromUtf8(content);
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/members.json`;
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: contentB64,
      sha,
      branch: env.MEMBERS_BRANCH,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.error("putMembersJson failed", r.status, body);
    throw new Error(`putMembersJson ${r.status}`);
  }
}

async function fetchMemberFile(env: Env, path: string): Promise<Response> {
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/${path}?ref=${env.MEMBERS_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github.raw",
    },
  });
  if (!r.ok) return new Response(`Not found: ${path}`, { status: r.status === 404 ? 404 : 502 });
  return new Response(r.body, {
    status: 200,
    headers: {
      "Content-Type": guessContentType(path),
      "Cache-Control": "private, max-age=60",
    },
  });
}

function guessContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "json": return "application/json; charset=utf-8";
    case "pdf":  return "application/pdf";
    case "md":   return "text/markdown; charset=utf-8";
    case "txt":  return "text/plain; charset=utf-8";
    case "html": return "text/html; charset=utf-8";
    case "png":  return "image/png";
    case "jpg":  case "jpeg": return "image/jpeg";
    case "csv":  return "text/csv; charset=utf-8";
    case "zip":  return "application/zip";
    case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default: return "application/octet-stream";
  }
}

// ─── Resend ────────────────────────────────────────────────────────────

async function sendMagicLinkEmail(
  env: Env,
  toEmail: string,
  name: string,
  link: string,
  minutes: number,
): Promise<void> {
  const fromHeader = env.SENDER_NAME
    ? `${env.SENDER_NAME} <${env.SENDER_EMAIL}>`
    : env.SENDER_EMAIL;

  const text = [
    `Hi${name ? " " + name : ""},`,
    "",
    `Here's your sign-in link for the AsPEN members area:`,
    "",
    link,
    "",
    `It's valid for ${minutes} minutes. If you didn't ask for this, you can ignore this email.`,
    "",
    "— AsPEN",
  ].join("\n");

  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;max-width:480px;margin:0 auto;padding:24px;">
  <p>Hi${name ? " " + escapeHtml(name) : ""},</p>
  <p>Here's your sign-in link for the AsPEN members area:</p>
  <p style="margin:24px 0;">
    <a href="${escapeAttr(link)}" style="display:inline-block;background:#21443e;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">
      Sign in to AsPEN
    </a>
  </p>
  <p style="font-size:12px;color:#64748b;">
    It's valid for ${minutes} minutes. If you didn't ask for this, you can ignore this email.<br>
    Or copy this link into your browser:<br>
    <span style="word-break:break-all;">${escapeHtml(link)}</span>
  </p>
  <p style="font-size:12px;color:#64748b;">— AsPEN</p>
</body></html>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromHeader,
      to: toEmail,
      subject: "Your AsPEN sign-in link",
      text,
      html,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.error("resend failed", r.status, body);
    throw new Error(`resend ${r.status}`);
  }
}

// ─── Password hashing (PBKDF2-SHA256 via Web Crypto) ──────────────────

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const bits = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlBytes(salt)}$${b64urlBytes(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iters = parseInt(parts[1], 10);
  if (!iters || iters < 1000 || iters > 1_000_000) return false;
  const salt = b64urlDecodeBytes(parts[2]);
  const expected = parts[3];
  const bits = await pbkdf2(password, salt, iters);
  const actual = b64urlBytes(new Uint8Array(bits));
  return timingSafeEqual(actual, expected);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    PBKDF2_KEYLEN * 8,
  );
}

// ─── Session cookie + JWT ──────────────────────────────────────────────

function buildSessionCookie(jwt: string, days: number): string {
  const maxAge = days * 24 * 60 * 60;
  // SameSite=None is required because the AsPEN site and the worker are
  // different registrable domains; cross-origin fetch needs cookies to be
  // SameSite=None+Secure to be sent.
  return [
    `${SESSION_COOKIE}=${jwt}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=None",
  ].join("; ");
}

async function sessionEmail(req: Request, env: Env): Promise<string | null> {
  // Auth fallback chain:
  //   1. Authorization: Bearer <jwt>   — used by iOS Safari / any browser
  //      that blocks third-party cookies. The site stores the JWT in
  //      localStorage on login / magic-link verify and sends it here.
  //   2. Cookie aspen_session=<jwt>    — preferred on browsers that allow
  //      cross-site cookies (HttpOnly, can't be exfiltrated by XSS).
  // Either path validates the same session JWT, so handlers don't care
  // which one the client used.
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(\S+)$/i);
  if (bearer) {
    const payload = await verifyJwt(bearer[1], env.JWT_SECRET);
    if (payload && payload.purpose === "session") return payload.sub;
  }
  const cookie = req.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  const payload = await verifyJwt(match[1], env.JWT_SECRET);
  if (!payload || payload.purpose !== "session") return null;
  return payload.sub;
}

async function signJwt(
  payload: Omit<JwtPayload, "iat" | "exp">,
  secret: string,
  ttlSec: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = { ...payload, iat: now, exp: now + ttlSec };
  const header = { alg: "HS256", typ: "JWT" };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(full))}`;
  const sig = await hmacSha256(secret, data);
  return `${data}.${sig}`;
}

async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = await hmacSha256(secret, `${parts[0]}.${parts[1]}`);
  if (!timingSafeEqual(expected, parts[2])) return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[1])) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64urlBytes(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function b64url(s: string): string {
  return b64urlBytes(new TextEncoder().encode(s));
}

function b64urlBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (s.length % 4)) % 4);
  return atob(padded);
}

function b64urlDecodeBytes(s: string): Uint8Array {
  const bin = b64urlDecode(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// UTF-8 safe base64 helpers (btoa/atob alone choke on multi-byte chars).
function base64FromUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function utf8FromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function corsHeaders(origin: string, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allow = allowed.includes(origin) ? origin : allowed[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    // Authorization must be listed because the site's Bearer-token
    // fallback (for browsers that drop the SameSite=None cookie)
    // sends `Authorization: Bearer <jwt>`. Browsers treat that as a
    // non-simple header and run a preflight; without this allow-list
    // the preflight fails and the actual request never reaches us.
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

async function safeJson<T>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}

function jsonResponse(data: unknown, status = 200, extra?: Headers): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  if (extra) for (const [k, v] of extra.entries()) headers.append(k, v);
  return new Response(JSON.stringify(data), { status, headers });
}

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
