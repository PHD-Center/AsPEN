# AsPEN SIG — Asian Pharmacoepidemiology Network

Static site for the AsPEN Special Interest Group, built with [Astro](https://astro.build/) and [Tailwind CSS](https://tailwindcss.com/), deployed to GitHub Pages.

## Local development

```bash
npm install
npm run dev          # http://localhost:4321/AsPEN/
npm run build        # output to ./dist
npm run preview      # serve the production build locally
```

## Project layout

```
src/
├─ layouts/BaseLayout.astro        site shell (header / footer / <head>)
├─ components/                     reusable UI blocks
├─ pages/                          file-based routing (each .astro = one URL)
├─ data/                           JSON content (databases, members, publications, history)
├─ content/                        Markdown content collections (spotlight, activities)
└─ styles/globals.css              Tailwind + theme tokens
public/                            static assets (images, favicon, CNAME)
```

## Editing content (non-developer guide)

| Want to update… | Edit this file |
|---|---|
| Mission / Chair / About text | `src/pages/about.astro` |
| Databases table | `src/data/databases.json` |
| National members & contacts | `src/data/members.json` |
| Publications list | `src/data/publications.json` |
| History timeline | `src/data/history.json` |
| Add a Spotlight study | new `.md` in `src/content/spotlight/` |
| Add an AsPEN study | new `.md` in `src/content/activities/` |

After saving, commit and push to `main` — GitHub Actions rebuilds and redeploys automatically.

## Deployment

1. Create a GitHub repo and push this folder.
2. Repo **Settings → Pages → Source = GitHub Actions**.
3. `site` and `base` are pre-set for `https://phd-center.github.io/AsPEN/`. Change them only if you fork to a different owner or use a custom domain.
5. Push to `main`; the workflow at `.github/workflows/deploy.yml` builds and deploys.

### Switching to `aspensig.asia`

1. Drop a file `public/CNAME` containing the single line `aspensig.asia`.
2. At your DNS provider, set apex `A` records to GitHub Pages IPs:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
3. In repo Settings → Pages → Custom domain, enter `aspensig.asia` and tick **Enforce HTTPS** once the certificate is issued.
4. Change `astro.config.mjs` → `site: 'https://aspensig.asia'`, `base: '/'`.
