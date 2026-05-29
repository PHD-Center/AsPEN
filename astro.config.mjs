// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

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
  vite: {
    plugins: [tailwindcss()],
  },
});
