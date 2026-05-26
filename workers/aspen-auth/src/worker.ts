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
      } else if (url.pathname === "/api/logout" && req.method === "POST") {
        resp = handleLogout();
      } else if (url.pathname.startsWith("/api/content/") && req.method === "GET") {
        resp = await handleContent(req, env, url.pathname.slice("/api/content/".length));
      } else if (url.pathname.startsWith("/api/list/") && req.method === "GET") {
        resp = await handleList(req, env, url.pathname.slice("/api/list/".length));
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
    await sendMagicLinkEmail(env, email, member.name, link, minutes);
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

  const target = `${env.SITE_BASE_URL.replace(/\/$/, "")}/members/`;
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

// Shared: issue a session cookie response for a logged-in email.
async function issueSessionResponse(email: string, env: Env): Promise<Response> {
  const days = parseInt(env.SESSION_DAYS, 10) || 30;
  const session = await signJwt(
    { sub: email, purpose: "session" },
    env.JWT_SECRET,
    days * 24 * 60 * 60,
  );
  const headers = new Headers();
  headers.set("Set-Cookie", buildSessionCookie(session, days));
  return jsonResponse({ ok: true }, 200, headers);
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
    "Access-Control-Allow-Headers": "Content-Type",
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
