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
// Set to empty string while undeployed; the /members/* pages will
// render an "auth not yet configured" notice instead of attempting
// network calls.
// TEMP: pointed at workers.dev until auth.aspensig.asia is bound in the
// Cloudflare dashboard (Workers & Pages → aspen-auth → Settings →
// Domains → Add Custom Domain → auth.aspensig.asia). Once bound,
// flip this back to https://auth.aspensig.asia so iOS Safari's
// third-party-cookie block stops killing mobile login.
export const WORKER_URL: string = "https://aspen-auth.danielhttsai.workers.dev";
