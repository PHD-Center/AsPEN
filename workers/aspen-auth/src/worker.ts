/**
 * AsPEN member-auth Worker.
 *
 * Three endpoints, called by the static AsPEN site under /members/*:
 *
 *   POST /api/request-login   body: { email }
 *     · Looks up email in PHD-Center/aspen-members → members.json
 *     · If active or invited, signs a short-lived JWT and emails a magic
 *       link via Resend. Always returns 200 OK (no enumeration).
 *
 *   GET  /api/verify?t=<jwt>
 *     · Validates the JWT signature + expiry + purpose=magic
 *     · Issues a long-lived session JWT in an HttpOnly cookie
 *     · 302 to SITE_BASE_URL/members/
 *
 *   GET  /api/content/<path>
 *     · Validates the session cookie
 *     · Fetches the file from MEMBERS_REPO at <path> via GitHub Contents API
 *     · Streams the bytes back to the client
 *
 *   GET  /api/me
 *     · Returns the current member's record (without leaking other members)
 *     · 401 if no valid session
 *
 * Secrets (set with `wrangler secret put <NAME>`):
 *   GITHUB_PAT       Fine-grained PAT, scoped to MEMBERS_REPO, Contents:Read
 *   JWT_SECRET       Random 32+ bytes used to sign JWTs
 *   RESEND_API_KEY   Resend API key for sending magic-link emails
 *
 * Env vars (set in wrangler.toml [vars]):
 *   MEMBERS_REPO, MEMBERS_BRANCH, SITE_BASE_URL, ALLOWED_ORIGINS,
 *   SENDER_EMAIL, SENDER_NAME, SESSION_DAYS, MAGIC_LINK_MINUTES
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
}

interface JwtPayload {
  sub: string;       // member email (lowercased)
  purpose: "magic" | "session";
  iat: number;
  exp: number;
}

const SESSION_COOKIE = "aspen_session";

// ─── Main fetch handler ─────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") ?? "";
    const cors = corsHeaders(origin, env);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      let resp: Response;
      if (url.pathname === "/api/request-login" && req.method === "POST") {
        resp = await handleRequestLogin(req, env);
      } else if (url.pathname === "/api/verify" && req.method === "GET") {
        resp = await handleVerify(req, env);
      } else if (url.pathname === "/api/me" && req.method === "GET") {
        resp = await handleMe(req, env);
      } else if (url.pathname === "/api/logout" && req.method === "POST") {
        resp = handleLogout();
      } else if (url.pathname.startsWith("/api/content/") && req.method === "GET") {
        resp = await handleContent(req, env, url.pathname.slice("/api/content/".length));
      } else if (url.pathname === "/" || url.pathname === "") {
        resp = new Response("aspen-auth worker — ok", { status: 200 });
      } else {
        resp = new Response("Not Found", { status: 404 });
      }

      // Attach CORS to every response
      for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
      return resp;
    } catch (err) {
      console.error("worker error", err);
      return new Response("Internal error", { status: 500, headers: cors });
    }
  },
};

// ─── Routes ────────────────────────────────────────────────────────────

async function handleRequestLogin(req: Request, env: Env): Promise<Response> {
  const body = await safeJson<{ email?: string }>(req);
  const email = (body?.email ?? "").trim().toLowerCase();
  if (!isLikelyEmail(email)) {
    return jsonResponse({ ok: true }); // don't leak invalid format
  }

  const members = await fetchMembers(env);
  const member = members.find((m) => m.email.toLowerCase() === email);

  // Always 200 OK — never reveal whether the email is a member.
  // Only send the email if the member is active or invited.
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

async function handleVerify(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token) return new Response("Missing token", { status: 400 });

  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || payload.purpose !== "magic") {
    return new Response("Invalid or expired magic link", { status: 401 });
  }

  // Issue session token
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

  const members = await fetchMembers(env);
  const member = members.find((m) => m.email.toLowerCase() === email);
  if (!member || member.status !== "active") {
    return jsonResponse({ ok: false }, 401);
  }
  // Only return this member's own record (not the whole list).
  return jsonResponse({
    ok: true,
    member: {
      email: member.email,
      name: member.name,
      affiliation: member.affiliation,
      country: member.country,
      role: member.role,
      joinedDate: member.joinedDate,
    },
  });
}

function handleLogout(): Response {
  const headers = new Headers();
  // Expire the cookie immediately
  headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  );
  return jsonResponse({ ok: true }, 200, headers);
}

async function handleContent(req: Request, env: Env, path: string): Promise<Response> {
  const email = await sessionEmail(req, env);
  if (!email) return new Response("Unauthorized", { status: 401 });

  // Guard against path traversal
  if (path.includes("..") || path.startsWith("/")) {
    return new Response("Bad request", { status: 400 });
  }

  // Only allow paths under papers/ or materials/ (defence in depth)
  if (!path.startsWith("papers/") && !path.startsWith("materials/")) {
    return new Response("Forbidden", { status: 403 });
  }

  // Refetch members to verify status is still active (cheap; cached headers
  // could be added later)
  const members = await fetchMembers(env);
  const member = members.find((m) => m.email.toLowerCase() === email);
  if (!member || member.status !== "active") {
    return new Response("Unauthorized", { status: 401 });
  }

  return fetchMemberFile(env, path);
}

// ─── GitHub API ────────────────────────────────────────────────────────

async function fetchMembers(env: Env): Promise<Member[]> {
  const text = await fetchMemberFileText(env, "members.json");
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? (data as Member[]) : [];
  } catch {
    return [];
  }
}

async function fetchMemberFileText(env: Env, path: string): Promise<string | null> {
  const r = await fetchMemberFile(env, path);
  if (!r.ok) return null;
  return await r.text();
}

async function fetchMemberFile(env: Env, path: string): Promise<Response> {
  // Use the raw download endpoint so we don't have to base64-decode.
  // application/vnd.github.raw streams the file body directly.
  const url = `https://api.github.com/repos/${env.MEMBERS_REPO}/contents/${path}?ref=${env.MEMBERS_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "aspen-auth-worker",
      Accept: "application/vnd.github.raw",
    },
  });
  if (!r.ok) {
    return new Response(`Not found: ${path}`, { status: r.status === 404 ? 404 : 502 });
  }
  // Pass through with reasonable content-type heuristic
  const ct = guessContentType(path);
  return new Response(r.body, {
    status: 200,
    headers: {
      "Content-Type": ct,
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

// ─── Session cookie + JWT ──────────────────────────────────────────────

function buildSessionCookie(jwt: string, days: number): string {
  const maxAge = days * 24 * 60 * 60;
  return [
    `${SESSION_COOKIE}=${jwt}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
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

// HS256 JWT — Web Crypto, no library
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
