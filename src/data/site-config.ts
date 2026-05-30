/**
 * Site-wide config that isn't tied to any one page or data file.
 *
 * The Worker URL is set here (not in env) so it's easy to find and
 * edit without touching CI / build secrets. It's a public endpoint
 * (CORS-restricted, not a secret), so committing it is fine.
 */

// AsPEN member-auth Worker (Cloudflare). After running `wrangler deploy`
// from workers/aspen-auth/, paste the printed URL here.
//
// Set to empty string while undeployed — the /members/* pages will
// render an "auth not yet configured" notice instead of attempting
// network calls.
export const WORKER_URL: string = "https://auth.aspensig.asia";
