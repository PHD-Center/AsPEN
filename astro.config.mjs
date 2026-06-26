// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// We deploy to two targets:
//   · https://www.aspensig.asia/  (PHDc NAS via WebDAV)     — base '/'
//   · https://phd-center.github.io/AsPEN/  (GitHub Pages)    — base '/AsPEN/'
// The CI workflow sets DEPLOY_TARGET=ghpages before building the GH Pages
// artifact so the asset paths come out as /AsPEN/... and the page renders
// correctly under the repo subpath. Default (no env var) is the apex
// build for the NAS.
const isGhPages = process.env.DEPLOY_TARGET === 'ghpages';

export default defineConfig({
  site: isGhPages ? 'https://phd-center.github.io' : 'https://www.aspensig.asia',
  base: isGhPages ? '/AsPEN' : '/',
  trailingSlash: 'ignore',
  integrations: [
    // Generates /sitemap-index.xml + /sitemap-0.xml at build time from the
    // `site` value above, so search engines can discover every public page.
    // The auth-gated /members/ area is excluded (no point indexing a login
    // shell). Submit the sitemap-index.xml URL in Google Search Console.
    sitemap({
      filter: (page) => !page.includes('/members'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
