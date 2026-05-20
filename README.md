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

You can edit everything **directly on GitHub.com — no local install needed.**

### Quick edits in the browser

1. Open the file on GitHub (e.g. https://github.com/PHD-Center/AsPEN/blob/main/src/data/databases.json).
2. Click the ✏️ pencil icon (top right of the file view).
3. Make your changes.
4. Scroll down, write a short "Commit message" (e.g. *"Update Taiwan NHIRD coverage"*), and click **Commit changes**.
5. Wait ~1 minute — GitHub Actions rebuilds, then refresh https://phd-center.github.io/AsPEN/.

Track progress at https://github.com/PHD-Center/AsPEN/actions — green check = live, red X = something broke (just revert your last edit by clicking the file's history).

### Where to edit what

| Want to update… | Edit this file |
|---|---|
| Brand colour (whole site) | `src/styles/globals.css` — change the `--color-brand-*` hex values |
| Hero headline / subhead | `src/components/Hero.astro` |
| Mission / Chair / About text | `src/pages/about.astro` |
| Databases table | `src/data/databases.json` |
| National members & contacts | `src/data/members.json` |
| Publications list | `src/data/publications.json` |
| History timeline | `src/data/history.json` |
| Add a Spotlight study | new `.md` file in `src/content/spotlight/` (copy `sample-spotlight.md`) |
| Add an AsPEN study | new `.md` file in `src/content/activities/` |
| Contact email | `src/pages/contact.astro` — change the `contactEmail` line |
| Favicon | replace `public/favicon.svg` |

### Changing the brand colour

The whole site uses six "brand" tokens defined in `src/styles/globals.css`. To re-theme, edit only those six hex values and push — Tailwind picks them up at build time.

```css
@theme {
  --color-brand-50:  #e8f4ee;   /* very pale  — backgrounds */
  --color-brand-100: #c8e4d2;   /* pale       — chips/tags */
  --color-brand-500: #3a8a6e;   /* primary    — main accent */
  --color-brand-600: #2d6e57;   /* darker     — buttons, links */
  --color-brand-700: #225641;   /* darkest    — hover states */
  --color-brand-900: #0f2e22;   /* near-black */

  --color-accent-500: #2a8b85;  /* used only for the Hero gradient's "from" stop */
}
```

Tools that help pick a palette:
- https://uicolors.app/create — paste your main hex (the `-500`), it generates the 50–900 scale
- https://tints.dev/ — similar, plus copy-as-CSS

After editing, commit on GitHub → wait ~1 min → reload the site.

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
